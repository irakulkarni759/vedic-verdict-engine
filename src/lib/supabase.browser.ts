import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Browser (anon) Supabase client — used ONLY in the browser, for magic-link
// auth and reading/writing the SIGNED-IN user's own profile row (protected by
// Row Level Security, so the anon key can't touch anyone else's data).
//
// Unlike supabase.server.ts's service-role client, this key is PUBLIC by
// design — it's meant to ship to the browser. That's why these env vars are
// VITE_-prefixed (Vite inlines them into the client bundle on purpose). Never
// put VEDA_SUPABASE_SECRET_KEY in a VITE_ var — that key must stay server-only.
//
// Returns null when the env vars aren't set (e.g. local dev without secrets),
// so callers can degrade gracefully — sign-in just shows as unavailable rather
// than throwing. Personalization still works fully without auth (localStorage).

const URL = import.meta.env.VITE_VEDA_SUPABASE_URL as string | undefined;
const ANON_KEY = import.meta.env.VITE_VEDA_SUPABASE_ANON_KEY as string | undefined;

let cached: SupabaseClient | null | undefined;

export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  if (typeof window === "undefined" || !URL || !ANON_KEY) {
    cached = null;
    return null;
  }
  cached = createClient(URL, ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Auto-exchange the token in the magic-link URL hash for a session on
      // page load — this is what completes the login when the user clicks
      // the link in their email.
      detectSessionInUrl: true,
    },
  });
  return cached;
}

/** Whether the browser auth env vars are present — used to hide the sign-in
 *  UI entirely when auth isn't wired up in this environment. */
export function isAuthConfigured(): boolean {
  return !!(URL && ANON_KEY);
}
