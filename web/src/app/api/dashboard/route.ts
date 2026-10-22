import { json, requireLead } from "./lead";
import type { DashboardData, DashboardIncident, DashboardSession, IncidentKind } from "@/app/dashboard/types";

// Society Safety HQ data. Lead-only, service role after the role check.
// Window: sessions ending in the last 6 h or the next 12 h ("tonight").

type SessionRow = { id: string; title: string; ends_at: string };
type RequestRow = { member_id: string; session_id: string };
type MatchRow = { id: string; session_id: string; seconds_to_match: number | null };
type IncidentRow = {
  id: string;
  kind: IncidentKind;
  status: "open" | "resolved";
  resolution: string | null;
  member_first_names: string[] | null;
  session_id: string | null;
  report_id: string | null;
  match_id: string | null;
  solo_trip_id: string | null;
  notion_page_id: string | null;
  grok_recommendation: string | null;
  alerted_at: string | null;
  created_at: string;
};
type ReportRow = {
  id: string;
  kind: "behaviour" | "scam" | "place";
  evidence: string;
  status: "pending" | "confirmed" | "rejected";
  reporter_id: string;
  reported_member_id: string | null;
};

const HOUR = 60 * 60 * 1000;

type StationEmbed = { name: string } | { name: string }[] | null;
type TripRow = { id: string; eta_at: string; stations: StationEmbed };
type MatchStationsRow = { id: string; checkin_due_at: string; a: { stations: StationEmbed } | null; b: { stations: StationEmbed } | null };

function stationName(e: StationEmbed | undefined): string | null {
  return (Array.isArray(e) ? e[0]?.name : e?.name) ?? null;
}

function londonHHMM(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

function notionUrl(id: string | null | undefined): string | null {
  const clean = id?.replace(/-/g, "").trim();
  return clean ? `https://www.notion.so/${clean}` : null;
}

function rows<T>(res: { data: unknown; error: { message: string } | null }, label: string): T[] {
  if (res.error) throw new Error(`${label}: ${res.error.message}`);
  return (res.data ?? []) as T[];
}

export async function GET() {
  const auth = await requireLead();
  if (!auth.ok) return auth.response;
  const { admin, communityIds, communityNames } = auth.lead;

  try {
    const now = Date.now();
    const from = new Date(now - 6 * HOUR).toISOString();
    const to = new Date(now + 12 * HOUR).toISOString();
    const incidentsSince = new Date(now - 18 * HOUR).toISOString();

    const [sessionsRes, incidentsRes, reportsRes, blockRes, membersRes] = await Promise.all([
      admin
        .from("study_sessions")
        .select("id, title, ends_at")
        .in("community_id", communityIds)
        .gte("ends_at", from)
        .lte("ends_at", to)
        .order("ends_at"),
      admin
        .from("incidents")
        .select("id, kind, status, resolution, member_first_names, session_id, report_id, match_id, solo_trip_id, notion_page_id, grok_recommendation, alerted_at, created_at")
        .in("community_id", communityIds)
        .or(`status.eq.open,created_at.gte.${incidentsSince}`)
        .order("created_at", { ascending: false })
        .limit(60),
      admin.from("reports").select("id", { count: "exact", head: true }).in("community_id", communityIds).eq("status", "pending"),
      admin.from("blocklist").select("handle_hash", { count: "exact", head: true }),
      admin.from("community_members").select("member_id").in("community_id", communityIds).limit(10000),
    ]);

    const sessions = rows<SessionRow>(sessionsRes, "sessions");
    const incidents = rows<IncidentRow>(incidentsRes, "incidents");
    if (reportsRes.error) throw new Error(`reports: ${reportsRes.error.message}`);
    if (blockRes.error) throw new Error(`blocklist: ${blockRes.error.message}`);
    const memberIds = new Set(rows<{ member_id: string }>(membersRes, "members").map((m) => m.member_id));

    const sessionIds = sessions.map((s) => s.id);
    const [requests, matches, soloCount] = sessionIds.length
      ? await Promise.all([
          admin.from("walk_requests").select("member_id, session_id").in("session_id", sessionIds).limit(5000).then((r) => rows<RequestRow>(r, "walk_requests")),
          admin.from("matches").select("id, session_id, seconds_to_match").in("session_id", sessionIds).limit(5000).then((r) => rows<MatchRow>(r, "matches")),
          admin
            .from("solo_trips")
            .select("id", { count: "exact", head: true })
            .in("session_id", sessionIds)
            .then((r) => {
              if (r.error) throw new Error(`solo_trips: ${r.error.message}`);
              return r.count ?? 0;
            }),
        ])
      : [[] as RequestRow[], [] as MatchRow[], 0];

    // Per-session counts for the "Tonight" list.
    const walkersBySession = new Map<string, Set<string>>();
    for (const r of requests) {
      if (!walkersBySession.has(r.session_id)) walkersBySession.set(r.session_id, new Set());
      walkersBySession.get(r.session_id)!.add(r.member_id);
    }
    const matchesBySession = new Map<string, number>();
    for (const m of matches) matchesBySession.set(m.session_id, (matchesBySession.get(m.session_id) ?? 0) + 1);
    const sessionList: DashboardSession[] = sessions.map((s) => ({
      id: s.id,
      title: s.title,
      ends_at: s.ends_at,
      walkers: walkersBySession.get(s.id)?.size ?? 0,
      matches: matchesBySession.get(s.id) ?? 0,
    }));

    const timed = matches.map((m) => m.seconds_to_match).filter((n): n is number => typeof n === "number" && n > 0);
    const avg = timed.length ? Math.round(timed.reduce((a, b) => a + b, 0) / timed.length) : null;

    // Incident details: session titles + report evidence (lead-only view).
    const missingSessionIds = [...new Set(incidents.map((i) => i.session_id).filter((id): id is string => !!id && !sessionIds.includes(id)))];
    const reportIds = incidents.map((i) => i.report_id).filter((id): id is string => !!id);
    const tripIds = [...new Set(incidents.map((i) => i.solo_trip_id).filter((id): id is string => !!id))];
    const matchIds = [...new Set(incidents.map((i) => i.match_id).filter((id): id is string => !!id))];
    const [extraSessions, reports, trips, walkMatches] = await Promise.all([
      missingSessionIds.length
        ? admin.from("study_sessions").select("id, title, ends_at").in("id", missingSessionIds).then((r) => rows<SessionRow>(r, "incident sessions"))
        : Promise.resolve([] as SessionRow[]),
      reportIds.length
        ? admin
            .from("reports")
            .select("id, kind, evidence, status, reporter_id, reported_member_id")
            .in("id", reportIds)
            .then((r) => rows<ReportRow>(r, "incident reports"))
        : Promise.resolve([] as ReportRow[]),
      tripIds.length
        ? admin.from("solo_trips").select("id, eta_at, stations(name)").in("id", tripIds).then((r) => rows<TripRow>(r, "incident trips"))
        : Promise.resolve([] as TripRow[]),
      matchIds.length
        ? admin
            .from("matches")
            .select("id, checkin_due_at, a:walk_requests!matches_request_a_fkey(stations(name)), b:walk_requests!matches_request_b_fkey(stations(name))")
            .in("id", matchIds)
            .then((r) => rows<MatchStationsRow>(r, "incident matches"))
        : Promise.resolve([] as MatchStationsRow[]),
    ]);
    const tripById = new Map(trips.map((t) => [t.id, t]));
    const walkById = new Map(walkMatches.map((m) => [m.id, m]));
    // One plain line: where they were heading and when they were due (stations only).
    const detailOf = (i: IncidentRow): string | null => {
      const t = i.solo_trip_id ? tripById.get(i.solo_trip_id) : undefined;
      const due = (iso: string) => (i.kind === "report" ? "" : ` · check-in due ${londonHHMM(iso)}`);
      if (t) return `Solo walk to ${stationName(t.stations) ?? "a station"}${due(t.eta_at)}`;
      const m = i.match_id ? walkById.get(i.match_id) : undefined;
      if (m) {
        const names = [...new Set([stationName(m.a?.stations), stationName(m.b?.stations)].filter((n): n is string => !!n))];
        return `Walk to ${names.join(" / ") || "a station"}${due(m.checkin_due_at)}`;
      }
      return null;
    };
    const titleById = new Map([...sessions, ...extraSessions].map((s) => [s.id, s.title]));
    const reportById = new Map(reports.map((r) => [r.id, r]));
    const reporterIds = [...new Set(reports.map((r) => r.reporter_id))];
    const reporterNames = reporterIds.length
      ? new Map(
          rows<{ id: string; first_name: string }>(await admin.from("members").select("id, first_name").in("id", reporterIds), "reporters").map(
            (m) => [m.id, m.first_name],
          ),
        )
      : new Map<string, string>();

    const incidentList: DashboardIncident[] = incidents
      .map((i) => {
        const rep = i.report_id ? reportById.get(i.report_id) : undefined;
        return {
          id: i.id,
          kind: i.kind,
          status: i.status,
          resolution: i.resolution,
          first_names: i.member_first_names ?? [],
          session_title: i.session_id ? (titleById.get(i.session_id) ?? null) : null,
          detail: detailOf(i),
          created_at: i.created_at,
          alerted_at: i.alerted_at,
          notion_url: notionUrl(i.notion_page_id),
          grok_recommendation: i.grok_recommendation,
          report: rep
            ? {
                kind: rep.kind,
                evidence: rep.evidence,
                status: rep.status,
                reporter_first_name: reporterNames.get(rep.reporter_id) ?? null,
                about_member: Boolean(rep.reported_member_id),
              }
            : null,
        };
      })
      .sort((a, b) => (a.status === b.status ? b.created_at.localeCompare(a.created_at) : a.status === "open" ? -1 : 1));

    const missed = incidents.filter((i) => i.kind === "missed_checkin");
    const baseline = Number(process.env.GROUP_CHAT_BASELINE_SECONDS);

    const body: DashboardData = {
      communities: communityNames,
      generated_at: new Date().toISOString(),
      stats: {
        sessions: sessions.length,
        walkers: new Set(requests.map((r) => r.member_id)).size,
        matches: matches.length,
        avg_seconds_to_match: avg,
        baseline_seconds: Number.isFinite(baseline) && baseline > 0 ? baseline : 600,
        missed_checkins: missed.length,
        open_missed_checkins: missed.filter((i) => i.status === "open").length,
        open_reports: reportsRes.count ?? 0,
        solo_walks: soloCount,
      },
      sessions: sessionList,
      incidents: incidentList,
      blocklist_count: blockRes.count ?? 0,
      members_count: memberIds.size,
      rules_url: notionUrl(process.env.NOTION_RULES_PAGE_ID),
    };
    return json(200, body);
  } catch (e) {
    console.error("[api/dashboard] failed:", e instanceof Error ? e.message : e);
    return json(500, { error: "dashboard_failed", message: "Couldn't load Safety HQ data" });
  }
}
