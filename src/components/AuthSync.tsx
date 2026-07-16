import { useEffect } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase.browser";
import { syncProfileOnSignIn } from "@/lib/auth";

// Mounted once at the app root. Watches auth state so that whenever a session
// is present — whether the user just clicked a magic link, or arrives already
// signed in on a fresh device — their account profile is synced into this
// device's localStorage. That's what makes personalization "follow" them
// across devices without any change to PersonalizeCard, which keeps reading
// localStorage exactly as before. Renders nothing.
export function AuthSync() {
  useEffect(() => {
    const sb = getSupabaseBrowserClient();
    if (!sb) return;

    const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
      // INITIAL_SESSION covers "already logged in on load"; SIGNED_IN covers a
      // fresh magic-link login. Both should reconcile the local profile.
      if ((event === "INITIAL_SESSION" || event === "SIGNED_IN") && session?.user) {
        syncProfileOnSignIn(session.user.id).catch(() => {
          // Best-effort — a failed sync just leaves localStorage as-is.
        });
      }
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  return null;
}
