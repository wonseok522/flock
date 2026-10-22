import { json, requireLead } from "../lead";
import type { DecideAction } from "@/app/dashboard/types";

// A human decides. Grok Bot only recommends. Every block and every report
// decision is made here by a signed-in society lead, for their own community.

const ACTIONS: DecideAction[] = ["confirm_block", "reject", "calling", "mark_safe"];

type IncidentRow = { id: string; kind: "missed_checkin" | "help" | "report"; status: string; community_id: string | null; report_id: string | null };
type ReportRow = { id: string; kind: string; status: string; reported_member_id: string | null };

export async function POST(request: Request) {
  let body: { incident_id?: unknown; action?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json(400, { error: "bad_request", message: "Send JSON: {incident_id, action}" });
  }
  const incidentId = typeof body.incident_id === "string" ? body.incident_id : "";
  const action = ACTIONS.find((a) => a === body.action);
  if (!incidentId || !action) return json(400, { error: "bad_request", message: "incident_id and a valid action are required" });

  const auth = await requireLead();
  if (!auth.ok) return auth.response;
  const { admin, userId, communityIds } = auth.lead;

  try {
    const { data: incData, error: incErr } = await admin
      .from("incidents")
      .select("id, kind, status, community_id, report_id")
      .eq("id", incidentId)
      .maybeSingle();
    if (incErr) throw incErr;
    const incident = incData as IncidentRow | null;
    if (!incident) return json(404, { error: "not_found", message: "Incident not found" });
    if (!incident.community_id || !communityIds.includes(incident.community_id)) {
      return json(403, { error: "not_lead", message: "Only this community's safety leads can decide this incident" });
    }
    const now = new Date().toISOString();

    if (action === "confirm_block" || action === "reject") {
      if (incident.kind !== "report" || !incident.report_id) return json(400, { error: "not_a_report", message: "Only reports can be confirmed or rejected" });
      const { data: repData, error: repErr } = await admin
        .from("reports")
        .select("id, kind, status, reported_member_id")
        .eq("id", incident.report_id)
        .maybeSingle();
      if (repErr) throw repErr;
      const report = repData as ReportRow | null;
      if (!report) return json(404, { error: "not_found", message: "Report not found" });
      if (report.status !== "pending") return json(409, { error: "already_decided", message: `This report was already ${report.status}` });

      if (action === "confirm_block") {
        if (!report.reported_member_id) {
          return json(400, { error: "no_member", message: "This report is about a place, not a member, so there's no one to block" });
        }
        const { data: memData, error: memErr } = await admin
          .from("members")
          .select("handle_hash")
          .eq("id", report.reported_member_id)
          .maybeSingle();
        if (memErr) throw memErr;
        const hash = (memData as { handle_hash: string } | null)?.handle_hash;
        if (!hash) return json(404, { error: "not_found", message: "Reported member not found" });

        // Shared cross-community blocklist: hashed handle only.
        const { error: blockErr } = await admin.from("blocklist").upsert(
          { handle_hash: hash, reason: `Confirmed ${report.kind} report`, confirmed_by_community: incident.community_id, confirmed_by_member: userId },
          { onConflict: "handle_hash", ignoreDuplicates: true },
        );
        if (blockErr) throw blockErr;
        // Blocked members can't match (find_buddies), so drop any open requests too.
        await admin.from("walk_requests").update({ status: "cancelled" }).eq("member_id", report.reported_member_id).eq("status", "open");
      }

      const { error: updRepErr } = await admin
        .from("reports")
        .update({ status: action === "confirm_block" ? "confirmed" : "rejected", decided_by: userId, decided_at: now })
        .eq("id", report.id);
      if (updRepErr) throw updRepErr;
      const { error: updIncErr } = await admin
        .from("incidents")
        .update({
          status: "resolved",
          resolution: action === "confirm_block" ? "Confirmed by a safety lead and added to the shared blocklist" : "Report rejected by a safety lead",
        })
        .eq("id", incident.id);
      if (updIncErr) throw updIncErr;
      return json(200, { ok: true });
    }

    if (incident.kind === "report") return json(400, { error: "is_report", message: "Use Confirm & block or Reject for reports" });
    const update =
      action === "calling"
        ? { resolution: "Lead is calling" }
        : { status: "resolved", resolution: "Marked safe by a safety lead" };
    const { error: updErr } = await admin.from("incidents").update(update).eq("id", incident.id);
    if (updErr) throw updErr;
    return json(200, { ok: true });
  } catch (e) {
    console.error("[api/dashboard/decide] failed:", e instanceof Error ? e.message : e);
    return json(500, { error: "decide_failed", message: "Couldn't save that decision. Try again." });
  }
}
