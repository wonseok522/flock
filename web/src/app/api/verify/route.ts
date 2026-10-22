import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Trust signals (CLAUDE.md trust table). Runs once per member, right after
// onboard() granted +40 for the verified university email.
//   GitHub account > 1 year  +15  "GitHub since 2019"
//   Devpost project          +10  "Has shipped projects on Devpost"
//   StopForumSpam hit        −100 (never shown to anyone, blocks matching)
// Each call has a 5 s timeout. A failed call adds nothing and is listed in
// `unavailable`. The score and the StopForumSpam result never leave the server.

const TIMEOUT_MS = 5000;
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

type Signal = { points: number; reason?: string };
type Check = { name: string; signal: Signal | null; unavailable: boolean };

const json = (status: number, body: unknown) => Response.json(body, { status });

async function github(handle: string): Promise<Check> {
  const name = "GitHub";
  try {
    const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "Flock-hackathon" };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetch(`https://api.github.com/users/${encodeURIComponent(handle)}`, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (res.status === 404) return { name, signal: null, unavailable: false };
    if (!res.ok) return { name, signal: null, unavailable: true };
    const body = (await res.json()) as { created_at?: string };
    if (!body.created_at) return { name, signal: null, unavailable: false };
    const created = new Date(body.created_at);
    const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
    if (created.getTime() < oneYearAgo) {
      return { name, signal: { points: 15, reason: `GitHub since ${created.getUTCFullYear()}` }, unavailable: false };
    }
    return { name, signal: null, unavailable: false };
  } catch {
    return { name, signal: null, unavailable: true };
  }
}

async function devpost(handle: string): Promise<Check> {
  const name = "Devpost";
  try {
    const res = await fetch(`https://devpost.com/software/search?query=${encodeURIComponent(handle)}`, {
      headers: { Accept: "application/json", "User-Agent": BROWSER_UA },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return { name, signal: null, unavailable: true };
    // Search is full-text, so only count projects where this handle is a team member.
    const body = (await res.json()) as { software?: { members?: unknown }[] };
    const me = handle.toLowerCase();
    const shipped = (body.software ?? []).some(
      (p) => Array.isArray(p.members) && p.members.some((m) => typeof m === "string" && m.toLowerCase() === me),
    );
    return shipped
      ? { name, signal: { points: 10, reason: "Has shipped projects on Devpost" }, unavailable: false }
      : { name, signal: null, unavailable: false };
  } catch {
    return { name, signal: null, unavailable: true };
  }
}

async function stopForumSpam(email: string): Promise<Check> {
  const name = "StopForumSpam";
  try {
    const res = await fetch(`https://api.stopforumspam.org/api?email=${encodeURIComponent(email)}&json`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return { name, signal: null, unavailable: true };
    const body = (await res.json()) as { success?: number; email?: { appears?: number } };
    if (body.success !== 1) return { name, signal: null, unavailable: true };
    // No reason string: a spam hit is never shown to anyone.
    return { name, signal: body.email?.appears ? { points: -100 } : null, unavailable: false };
  } catch {
    return { name, signal: null, unavailable: true };
  }
}

type MemberRow = { id: string; github_handle: string | null; trust_score: number; trust_reasons: string[]; verified_at: string | null };

export async function POST() {
  try {
    const sb = await supabaseServer();
    const { data: auth } = await sb.auth.getUser();
    const user = auth.user;
    if (!user) return json(401, { error: "not_signed_in" });

    const admin = supabaseAdmin();
    const { data: member, error } = await admin
      .from("members")
      .select("id, github_handle, trust_score, trust_reasons, verified_at")
      .eq("id", user.id)
      .maybeSingle<MemberRow>();
    if (error) throw error;
    if (!member) return json(404, { error: "not_onboarded" });
    if (member.verified_at) return json(200, { trust_reasons: member.trust_reasons, unavailable: [], already_verified: true });

    const checks: Promise<Check>[] = [];
    const handle = member.github_handle?.trim().replace(/^@/, "");
    if (handle) checks.push(github(handle), devpost(handle));
    if (user.email) checks.push(stopForumSpam(user.email.toLowerCase()));
    const results = await Promise.all(checks);

    const delta = results.reduce((sum, c) => sum + (c.signal?.points ?? 0), 0);
    const reasons = [...member.trust_reasons];
    for (const c of results) {
      const r = c.signal?.reason;
      if (r && !reasons.includes(r)) reasons.push(r);
    }
    const unavailable = results.filter((c) => c.unavailable).map((c) => c.name);
    unavailable.forEach((n) => console.warn(`[api/verify] ${n} unavailable; no points added`));

    // If every check failed nothing was learned, so leave verified_at empty and
    // let the next call try again. Otherwise mark verified (idempotent).
    const allFailed = results.length > 0 && unavailable.length === results.length;
    if (allFailed) return json(200, { trust_reasons: member.trust_reasons, unavailable });

    // Current score (40 from onboard, plus anything earned since) + signals.
    // The `verified_at is null` guard makes concurrent calls apply only once.
    const { data: updated, error: updErr } = await admin
      .from("members")
      .update({ trust_score: member.trust_score + delta, trust_reasons: reasons, verified_at: new Date().toISOString() })
      .eq("id", member.id)
      .is("verified_at", null)
      .select("trust_reasons");
    if (updErr) throw updErr;
    if (!updated?.length) {
      const { data: again } = await admin.from("members").select("trust_reasons").eq("id", member.id).maybeSingle<{ trust_reasons: string[] }>();
      return json(200, { trust_reasons: again?.trust_reasons ?? member.trust_reasons, unavailable: [], already_verified: true });
    }
    return json(200, { trust_reasons: (updated[0] as { trust_reasons: string[] }).trust_reasons, unavailable });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/verify] failed:", msg);
    if (/not set|URL and Key are required|supabaseUrl/i.test(msg)) return json(503, { error: "Supabase is not configured on the server" });
    return json(500, { error: "Couldn't check trust signals right now" });
  }
}
