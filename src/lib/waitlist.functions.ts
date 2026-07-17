import { createServerFn } from "@tanstack/react-start";
import { getSupabaseServiceClient } from "./supabase.server";
import { sanitizeProfile, type Profile } from "./profile";

// Waitlist signup: capture an email plus a snapshot of the visitor's
// questionnaire answers, so we can send personalized suggestions later. No
// accounts, no login — just an opt-in email. Writes go through the existing
// service-role client (same one personalization already uses), so this needs
// no new environment variables to work.

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const joinWaitlist = createServerFn({ method: "POST" })
  .inputValidator((d: { email: string; profile?: Profile; website?: string }) => d)
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string }> => {
    // Honeypot: a hidden field real users never fill. If it's populated it's a
    // bot — return success without persisting, so it doesn't learn it was caught.
    if (data.website && data.website.trim().length > 0) {
      return { ok: true };
    }

    const email = (data.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 254) {
      return { ok: false, error: "Enter a valid email address." };
    }

    // Strict enum validation — only known question values are stored, never
    // free-form input.
    const profile = sanitizeProfile(data.profile ?? {});

    try {
      const supabase = getSupabaseServiceClient();
      const { error } = await supabase
        .from("waitlist")
        .upsert({ email, profile, updated_at: new Date().toISOString() }, { onConflict: "email" });
      if (error) return { ok: false, error: "Couldn't join right now. Try again." };
      return { ok: true };
    } catch {
      // Supabase not configured, or a transient failure.
      return { ok: false, error: "Couldn't join right now. Try again." };
    }
  });
