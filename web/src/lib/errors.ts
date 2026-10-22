// Maps RPC error codes (raised in supabase/schema.sql) to plain-English messages.
const MESSAGES: Record<string, string> = {
  not_university_email: "Flock is for London university students. Use your university email (for example name@ucl.ac.uk).",
  blocked: "This account can't use Flock. If you think this is a mistake, contact your society's safety lead.",
  not_onboarded: "Finish setting up your profile first.",
  not_signed_in: "Please sign in again.",
  not_in_community: "You're not a member of this community.",
  not_in_session: "Join the session first.",
  unknown_station: "Pick a station from the list.",
  no_longer_available: "They've just matched with someone else. Pick another person or wait a moment.",
  request_not_found: "That walk request has expired. Start again.",
  ends_in_past: "The end time must be in the future.",
  bad_eta: "Pick an ETA between 1 and 180 minutes.",
  walk_not_finished: "You can vouch once you're both home.",
  not_your_walk: "This walk isn't yours.",
  not_your_trip: "This timer isn't yours.",
};

export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e);
  for (const [code, text] of Object.entries(MESSAGES)) if (msg.includes(code)) return text;
  if (/fetch|network|Failed to fetch/i.test(msg)) return "Can't reach Flock right now. Check your connection and try again.";
  return msg || "Something went wrong. Try again.";
}
