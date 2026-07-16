import { useEffect, useState } from "react";
import { getSupabaseBrowserClient, isAuthConfigured } from "./supabase.browser";
import { loadProfile, saveProfile, sanitizeProfile, type Profile } from "./profile";

// Magic-link auth on top of the localStorage profile. The account is NOT the
// runtime source of truth — localStorage still is (PersonalizeCard reads it
// unchanged). The account's only job is to REMEMBER a profile across devices:
// on sign-in we sync the two, and while signed in, saving writes to both.

export type AuthUser = { id: string; email: string | null };

/** Fired after syncProfileOnSignIn updates localStorage, so an open page
 *  (e.g. the profile questionnaire) can re-read the freshly synced answers. */
export const PROFILE_SYNCED_EVENT = "veda-profile-synced";

/** Session state for UI. Safe to call in multiple components — each just
 *  subscribes to the same GoTrue client. Starts "loading" on the server /
 *  first paint, resolves once the browser client reports the session. */
export function useAuth(): {
  user: AuthUser | null;
  status: "loading" | "ready";
  configured: boolean;
} {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<"loading" | "ready">("loading");

  useEffect(() => {
    const sb = getSupabaseBrowserClient();
    if (!sb) {
      setStatus("ready");
      return;
    }
    let mounted = true;

    sb.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setUser(toAuthUser(data.session?.user));
      setStatus("ready");
    });

    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setUser(toAuthUser(session?.user));
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { user, status, configured: isAuthConfigured() };
}

function toAuthUser(user: { id: string; email?: string } | undefined | null): AuthUser | null {
  return user ? { id: user.id, email: user.email ?? null } : null;
}

/** Sends a magic login link to `email`. The link returns to /profile, where
 *  detectSessionInUrl completes the sign-in. */
export async function signInWithEmail(email: string): Promise<{ ok: boolean; error?: string }> {
  const sb = getSupabaseBrowserClient();
  if (!sb) return { ok: false, error: "Sign-in isn't available right now." };

  const clean = email.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) {
    return { ok: false, error: "Enter a valid email address." };
  }

  const { error } = await sb.auth.signInWithOtp({
    email: clean,
    options: { emailRedirectTo: `${window.location.origin}/profile` },
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function signOut(): Promise<void> {
  const sb = getSupabaseBrowserClient();
  if (sb) await sb.auth.signOut();
}

/** Read the signed-in user's saved profile from their account row. RLS
 *  guarantees this can only ever return the caller's own row. */
export async function fetchAccountProfile(userId: string): Promise<Profile | null> {
  const sb = getSupabaseBrowserClient();
  if (!sb) return null;
  try {
    const { data, error } = await sb
      .from("profiles")
      .select("profile")
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data) return null;
    return sanitizeProfile((data.profile ?? {}) as Profile);
  } catch {
    return null;
  }
}

/** Upsert the signed-in user's profile into their account row. */
export async function saveAccountProfile(userId: string, profile: Profile): Promise<boolean> {
  const sb = getSupabaseBrowserClient();
  if (!sb) return false;
  try {
    const { error } = await sb.from("profiles").upsert(
      {
        user_id: userId,
        profile: sanitizeProfile(profile),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    return !error;
  } catch {
    return false;
  }
}

/**
 * Reconcile localStorage with the account on sign-in:
 *  - Account already has a profile → it wins (this is what "remembers you
 *    across devices" means), so we write it into localStorage.
 *  - Account is empty → seed it from whatever this device has locally, so the
 *    profile someone built before signing in isn't lost.
 * Then broadcast PROFILE_SYNCED_EVENT so an open questionnaire re-reads it.
 */
export async function syncProfileOnSignIn(userId: string): Promise<void> {
  const account = await fetchAccountProfile(userId);
  if (account && Object.keys(account).length > 0) {
    saveProfile(account);
  } else {
    const local = loadProfile();
    if (local) await saveAccountProfile(userId, local);
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PROFILE_SYNCED_EVENT));
  }
}
