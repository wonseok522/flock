// Shape of GET /api/dashboard (Society Safety HQ). First names only, never
// emails, surnames, handles or hashes.

export type IncidentKind = "missed_checkin" | "help" | "report";

export type DashboardIncident = {
  id: string;
  kind: IncidentKind;
  status: "open" | "resolved";
  resolution: string | null;
  first_names: string[];
  session_title: string | null;
  /** e.g. "Solo walk to Russell Square · check-in due 20:55". Stations only. */
  detail: string | null;
  created_at: string;
  alerted_at: string | null;
  notion_url: string | null;
  grok_recommendation: string | null;
  report: {
    kind: "behaviour" | "scam" | "place";
    evidence: string;
    status: "pending" | "confirmed" | "rejected";
    reporter_first_name: string | null;
    about_member: boolean;
  } | null;
};

export type DashboardSession = {
  id: string;
  title: string;
  ends_at: string;
  walkers: number;
  matches: number;
};

export type DashboardData = {
  communities: string[];
  generated_at: string;
  stats: {
    sessions: number;
    walkers: number;
    matches: number;
    avg_seconds_to_match: number | null;
    baseline_seconds: number;
    missed_checkins: number;
    open_missed_checkins: number;
    open_reports: number;
    solo_walks: number;
  };
  sessions: DashboardSession[];
  incidents: DashboardIncident[];
  blocklist_count: number;
  members_count: number;
  rules_url: string | null;
};

export type DecideAction = "confirm_block" | "reject" | "calling" | "mark_safe";
