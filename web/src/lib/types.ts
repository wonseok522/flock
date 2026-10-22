// Row shapes returned by the RPCs in supabase/schema.sql.

export type Member = {
  id: string;
  first_name: string;
  uni_domain: string;
  github_handle: string | null;
  trust_score: number;
  trust_reasons: string[];
  safe_walks: number;
  verified_at: string | null;
};

export type SessionOverview = {
  id: string;
  title: string;
  location_name: string | null;
  lat: number | null;
  lng: number | null;
  starts_at: string | null;
  ends_at: string;
  source: "student" | "luma";
  community_name: string;
  member_count: number;
  joined: boolean;
  member_names: string[];
};

export type Station = { id: number; name: string; lat: number; lng: number; distance_m: number };

export type Candidate = {
  candidate_request: string;
  first_name: string;
  uni_domain: string;
  station_name: string;
  trust_reasons: string[];
  safe_walks: number;
  dest_distance_m: number;
  minutes_apart: number;
  leave_at: string;
};

export type MyMatch = {
  match_id: string;
  status: "active" | "home_safe" | "missed_checkin" | "help";
  session_id: string;
  session_title: string;
  meeting_point: string | null;
  session_lat: number | null;
  session_lng: number | null;
  my_station: string;
  my_station_lat: number;
  my_station_lng: number;
  buddy_first_name: string;
  buddy_uni_domain: string;
  buddy_station: string;
  buddy_station_lat: number;
  buddy_station_lng: number;
  buddy_trust_reasons: string[];
  buddy_safe_walks: number;
  reason: string | null;
  reason_source: "cognee" | "unavailable" | null;
  seconds_to_match: number;
  checkin_due_at: string;
  my_checkin: "home_safe" | "need_help" | null;
  buddy_checkin: "home_safe" | "need_help" | null;
  i_vouched: boolean;
  buddy_leave_at: string;
};

export type MyTrip = {
  trip_id: string;
  status: "active" | "home_safe" | "overdue" | "help";
  session_id: string | null;
  session_title: string | null;
  station_name: string;
  station_lat: number;
  station_lng: number;
  session_lat: number | null;
  session_lng: number | null;
  leave_at: string;
  eta_at: string;
  alerted_at: string | null;
  escalated_at: string | null;
};

export type Active = { kind: "match" | "solo" | "request"; id: string; session_id: string | null };

export type Community = {
  id: string;
  name: string;
  domains: string[];
  role: "member" | "lead";
  member_count: number;
  next_session_title: string | null;
  next_session_ends_at: string | null;
};

export type SessionWalk = {
  match_id: string;
  first_names: string[];
  station_names: string[];
  status: MyMatch["status"];
  created_at: string;
};
