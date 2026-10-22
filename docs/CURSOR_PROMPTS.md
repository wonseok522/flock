# Cursor prompts — one per step, in order

Paste one prompt at a time. After each step: test on two phones, commit with `[cursor]`, append to `BUILD_LOG.md`.

Every prompt starts with the same header:

```text
Read CLAUDE.md first. Rule #1: fully use the partner integrations and code
to the judging criteria. Start your reply with
"Criteria: ... | Partners: ...". Follow the tech stack, repo layout, safety
rules and definition of done in CLAUDE.md.
```

---

## Step 1 — Scaffold + auth (Supabase)

```text
Scaffold web/ with Next.js (App Router), TypeScript strict, Tailwind,
shadcn/ui, @supabase/ssr and @supabase/supabase-js. Create lib/supabase
(server + browser clients) and middleware for session refresh.

Pages:
- /login: email magic link. Reject emails whose domain is not in
  FLOCK_ALLOWED_EMAIL_DOMAINS with a clear message.
- /onboard: first name, optional GitHub handle. Insert into members with
  uni_domain and handle_hash = sha256(lowercase email). Add the member to
  the community whose allowed_email_domains includes their domain.
Mobile-first, large tap targets, readable on a projector.
```

## Step 2 — Study sessions + Luma import

```text
- /sessions: list sessions for my communities (ending soonest first),
  "Create session" form (title, location name, picked on a Leaflet map, end time).
- /sessions/[id]: details, "Join", member count, "Find a walk buddy" button.
- scripts/import-luma.ts: fetch the Luma .ics for HACK_COLLECTIVE_LUMA_CAL_ID,
  import events ending after 21:00 as study_sessions (source='luma').
  Also fetch https://api.lu.ma/event/get?event_api_id=LUMA_TONIGHT_EVENT_ID
  for venue lat/lng; fall back to 51.4951,-0.2282 and label it.
- scripts/seed-stations.ts: OSM Overpass query for node["railway"="station"]
  in Greater London → stations table.
On session join, POST to Cognee /remember: "<first name> studied at <session>
on <date>".
```

## Step 3 — Walk flow + matching + Realtime (core demo)

```text
- /sessions/[id]/walk: searchable station picker (stations table, show
  distance from session), leave-time slider (now → +60 min).
- Insert walk_request, then call rpc('find_buddies'). Subscribe with
  Supabase Realtime to walk_requests for this session so matches appear
  live without refresh.
- Record seconds from request to first match in matches.seconds_to_match.
- Empty state: "No one yet. We'll notify you live, or start a solo
  check-in timer." with a button to the solo flow.
```

## Step 4 — Trust reasons (Cognee + verify)

```text
- /api/verify: GitHub REST (created_at, public_repos), Devpost search,
  StopForumSpam on email. Compute trust_score and trust_reasons exactly as
  in the CLAUDE.md trust table. Timeouts + labelled fallbacks.
- ai-service/main.py (FastAPI): POST /remember {text}, POST /trust
  {member_a, member_b} → reason from Cognee recall. requirements.txt.
- Match card: first name, station, minutes apart, trust_reasons chips,
  Cognee reason ("trust reason unavailable" if the call fails).
  Buttons: "Walk together" (creates match, meeting point = session
  location), "Report".
```

## Step 5 — Check-ins, solo timer, Notion incidents, Discord bot

```text
- /checkin/[matchId]: "I'm home ✅" / "I need help 🆘". 🆘 screen shows
  "In an emergency, call 999" first, then university security contacts.
- On ✅ from both: Cognee /remember "<A> and <B> walked safely from
  <session> to <station> on <date>", +10 trust each.
- /solo/[tripId]: pick station + ETA; big countdown; "I'm home" button.
- lib/notion.ts: createIncident() into NOTION_INCIDENTS_DB_ID.
- bot/ (discord.js v14): every minute poll overdue_solo_trips and matches
  older than 45 min without check-ins → DM / alert session thread, create
  Notion incident, set alerted_at. Slash command /flock <sessionId> posts
  the walk link.
```

## Step 6 — Zero, dashboard, blocklist

```text
- /api/zero: on new member or new community, POST to ZERO_WEBHOOK_URL
  (first name, community, uni domain only).
- /dashboard (community leads only): tonight's sessions, walkers, matches,
  average seconds to match (big number — our 10x metric), missed
  check-ins, pending reports, and a link to Notion Safety HQ.
- "Confirm report" adds the reported member's handle_hash to blocklist and
  updates the Notion incident. Show that a blocked user gets no matches.
```

## Step 7 — Stretch: Scam shield (only if Steps 1–6 are demo-tested)

```text
- scripts/eval-scam-filter.py: pull 500 rows of the SMS spam dataset,
  score with detoxify + keyword rules, print precision/recall.
- Bot: flag scam-like messages in session threads, draft a warning for a
  human to post, offer "Report" which creates a report + Notion incident.
```
