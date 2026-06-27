import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Service-role client. This bypasses Row Level Security, so it must only
// ever be used inside .server.ts files / createServerFn handlers — never
// imported into a component or any file bundled for the browser.
//
// NOTE: the env var names here are NOT "SUPABASE_URL" / "SUPABASE_SERVICE_ROLE_KEY"
// — Lovable reserves the SUPABASE_ prefix for its own internal use, and
// rejects any secret you try to create with that prefix. Using VEDA_-prefixed
// names instead sidesteps that.
//
// Reads env lazily inside the getter (not at module scope) so the value is
// never inlined into the client bundle and works correctly under Worker SSR.
// See: TanStack Start execution-model docs.

let cachedClient: SupabaseClient | null = null;

export function getSupabaseServiceClient(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const url = process.env.VEDA_SUPABASE_URL;
  const serviceKey = process.env.VEDA_SUPABASE_SECRET_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "VEDA_SUPABASE_URL / VEDA_SUPABASE_SECRET_KEY are not set. Add them as server secrets in your deployment settings — NOT as VITE_-prefixed vars, which get bundled into client code.",
    );
  }

  cachedClient = createClient(url, serviceKey, { auth: { persistSession: false } });
  return cachedClient;
}
