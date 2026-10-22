import { supabaseServer } from "@/lib/supabase/server";

// Growth: a new verified member → Zero follow-up sequence (Zero partner).
// Sends first name, community, university domain and join time only. Never
// the email. Never blocks onboarding and never throws to the client.

const TIMEOUT_MS = 5000;
const json = (status: number, body: unknown) => Response.json(body, { status });

type MembershipRow = { joined_at: string; communities: { name: string } | { name: string }[] | null };

export async function POST() {
  try {
    const sb = await supabaseServer();
    const { data: auth } = await sb.auth.getUser();
    if (!auth.user) return json(401, { forwarded: false, reason: "not_signed_in" });

    const { data: member } = await sb
      .from("members")
      .select("first_name, uni_domain")
      .eq("id", auth.user.id)
      .maybeSingle<{ first_name: string; uni_domain: string }>();
    if (!member) return json(200, { forwarded: false, reason: "not_onboarded" });

    const { data: memberships } = await sb
      .from("community_members")
      .select("joined_at, communities(name)")
      .eq("member_id", auth.user.id)
      .order("joined_at", { ascending: true });
    const first = (memberships as MembershipRow[] | null)?.[0];
    const comm = Array.isArray(first?.communities) ? first?.communities[0] : first?.communities;

    const payload = {
      event: "member.joined",
      first_name: member.first_name,
      community: comm?.name ?? null,
      uni_domain: member.uni_domain,
      joined_at: first?.joined_at ?? new Date().toISOString(),
    };

    const url = process.env.ZERO_WEBHOOK_URL;
    if (!url) {
      console.warn("[api/zero] ZERO_WEBHOOK_URL not set: member.joined not forwarded");
      return json(200, { forwarded: false, reason: "ZERO_WEBHOOK_URL not set" });
    }

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
      if (!res.ok) {
        console.warn(`[api/zero] Zero webhook answered ${res.status}`);
        return json(200, { forwarded: false, reason: `Zero answered ${res.status}` });
      }
      return json(200, { forwarded: true });
    } catch (e) {
      console.warn("[api/zero] Zero webhook unreachable:", e instanceof Error ? e.message : e);
      return json(200, { forwarded: false, reason: "Zero unreachable" });
    }
  } catch (e) {
    console.error("[api/zero] failed:", e instanceof Error ? e.message : e);
    return json(200, { forwarded: false, reason: "Server not configured" });
  }
}
