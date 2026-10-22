import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const json = (status: number, body: unknown) => Response.json(body, { status });

export type Lead = { userId: string; admin: SupabaseClient; communityIds: string[]; communityNames: string[] };

/**
 * Signed-in user who is a `lead` in at least one community. The service role
 * is used only after this check (incidents and blocklist are service-role only).
 */
export async function requireLead(): Promise<{ ok: true; lead: Lead } | { ok: false; response: Response }> {
  let userId: string | undefined;
  try {
    const sb = await supabaseServer();
    const { data } = await sb.auth.getUser();
    userId = data.user?.id;
  } catch {
    return { ok: false, response: json(503, { error: "not_configured", message: "Supabase is not configured on the server" }) };
  }
  if (!userId) return { ok: false, response: json(401, { error: "not_signed_in" }) };

  let admin: SupabaseClient;
  try {
    admin = supabaseAdmin();
  } catch {
    return { ok: false, response: json(503, { error: "not_configured", message: "SUPABASE_SERVICE_ROLE_KEY is not set" }) };
  }

  const { data, error } = await admin
    .from("community_members")
    .select("community_id, communities(name)")
    .eq("member_id", userId)
    .eq("role", "lead");
  if (error) {
    console.error("[api/dashboard] lead check failed:", error.message);
    return { ok: false, response: json(500, { error: "lead_check_failed", message: "Couldn't check your role" }) };
  }
  const rows = (data ?? []) as { community_id: string; communities: { name: string } | { name: string }[] | null }[];
  if (!rows.length) return { ok: false, response: json(403, { error: "not_lead" }) };

  return {
    ok: true,
    lead: {
      userId,
      admin,
      communityIds: rows.map((r) => r.community_id),
      communityNames: rows
        .map((r) => (Array.isArray(r.communities) ? r.communities[0]?.name : r.communities?.name))
        .filter((n): n is string => Boolean(n)),
    },
  };
}
