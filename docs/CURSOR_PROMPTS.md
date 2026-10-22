# Cursor prompts — one per step, in order

Plan, owners and times: [`BUILD_PLAN.md`](BUILD_PLAN.md). **A** = web, **B** = data + worker.

After each step: test it, commit with `[cursor] Step N: …`, and append one line to `BUILD_LOG.md`.

Every prompt starts with the same header:

```text
Read CLAUDE.md and docs/BUILD_PLAN.md first. Rule #1: fully use the partner
integrations and code to the judging criteria. Start your reply with
"Criteria: ... | Partners: ...". Follow the tech stack, repo layout, safety
rules and definition of done in CLAUDE.md. Where BUILD_PLAN.md section 1
changes a decision, BUILD_PLAN.md wins.
```

---

## Step 0 — Schema fixes + seeds (B) · Supabase

```text
Fix supabase/schema.sql per BUILD_PLAN.md audit S1–S8. Keep it runnable
top-to-bottom on a fresh project.

1. members: add safe_walks int default 0. Revoke insert, update on members
   from authenticated; grant update (first_name, github_handle,
   discord_user_id, emergency_contact) to authenticated.
2. matches: add checkin_due_at timestamptz, alerted_at timestamptz.
   incidents: add grok_recommendation text, member_first_names text[].
   checkins.solo_trip_id → FK to solo_trips.
3. Security-definer RPCs (set search_path = public, use auth.uid()):
   - onboard(p_first_name text, p_github text) → members row.
     Read the email from auth.users; domain = part after '@'. Raise
     'not_university_email' if no community has it in
     allowed_email_domains. handle_hash = encode(digest(lower(email),
     'sha256'),'hex'). trust_score = 40, trust_reasons =
     {'Verified <community name> student'}. Insert community_members for
     every matching community. Raise 'blocked' if handle_hash is on the
     blocklist.
   - join_session(p_session uuid): caller must be in the session's community.
   - session_roster(p_session uuid) → first_name, trust_reasons, count only.
   - request_walk(p_session uuid, p_station bigint, p_leave_at timestamptz)
     → match id or null. Caller must be in session_members and not
     blocklisted. destination = stations.location. Cancel the caller's other
     open requests for this session. Insert the request, take the best row
     from find_buddies(new_id), lock the candidate (for update skip locked),
     insert matches (meeting_point = session location_name,
     seconds_to_match = seconds since the candidate request was created,
     checkin_due_at = greatest leave_at + CHECKIN_WINDOW_MIN minutes, read
     from a settings table, default 45). Set both requests to 'matched'.
   - my_match(p_match uuid) → buddy first_name, buddy station, trust_score,
     trust_reasons, safe_walks, reason, meeting_point, seconds_to_match,
     status. Participants only.
   - check_in(p_match uuid, p_trip uuid, p_status text): insert checkins.
     need_help → set status 'help' and insert incidents(kind 'help').
     home_safe from both match participants → matches.status 'home_safe',
     each member safe_walks + 1, trust_score + 10. Solo home_safe →
     solo_trips.status 'home_safe'.
   - start_solo(p_session uuid, p_station bigint, p_eta_minutes int).
   - vouch(p_match uuid): only after both checked in home_safe; one vouch
     per member per match; buddy trust_score + 15 and add 'Vouched for by a
     walk buddy' to trust_reasons once.
4. revoke all on overdue_solo_trips from anon, authenticated.
5. settings table (key text pk, value text) with checkin_window_min = '45'.
   Service role only.
6. Realtime publication: matches, incidents, study_sessions, session_members.
7. supabase/seed.sql: communities 'The Hack Collective' (all London uni
   domains + 'demo.flock.test') and 'UCL' ('ucl.ac.uk').
8. scripts/seed-stations.ts: Overpass node["railway"="station"] in Greater
   London → stations (upsert by OSM id). Browser User-Agent, 30 s timeout.
9. scripts/seed-demo.ts: create synthetic users from the Grok Bot personas
   (G4) with supabase.auth.admin.createUser({email_confirm: true}) at
   @demo.flock.test, call onboard as each one, put one on the blocklist,
   make one a 'lead'. Never use real people's data.
10. supabase/test.sql: as two seed users (set request.jwt.claims),
    join_session + request_walk prove a match is created and that the
    blocked user gets none.
```

## Step 1 — Scaffold + auth + deploy (A) · Supabase

```text
Scaffold web/ with create-next-app (latest stable, App Router, TS strict,
Tailwind, src/), shadcn/ui, @supabase/ssr, @supabase/supabase-js. Follow the
current @supabase/ssr Next.js guide for the session-refresh file (it is
proxy.ts on Next 16+, middleware.ts before that).

- /login: email → supabase.auth.signInWithOtp. Then show a 6-digit code
  input (verifyOtp type 'email'); the emailed link also works. A friendly
  client-side hint for non-university domains, but the real check is the
  onboard() RPC.
- /onboard: first name, optional GitHub handle → rpc('onboard'). Map
  'not_university_email' and 'blocked' to clear messages.
- Every app page: no session → /login; no members row → /onboard.
- Big type, 48px tap targets, high contrast. Readable on a projector.
- Deploy to Vercel now and tell me which env vars to set there.
```

## Step 2 — Study sessions (A) · Supabase, Cognee (via worker)

```text
- /sessions: sessions for my communities, ending soonest first, with a
  "Hack Collective · Luma" badge for source='luma'. Loading, empty and error
  states.
- Create session: title, location name, end time, location picked on a
  Leaflet map (dynamic import, ssr:false, OSM tiles), centred on the venue
  (51.4951, -0.2282), with a "Use my location" button.
- /sessions/[id]: details, rpc('join_session'), roster count from
  rpc('session_roster') (first names only), "Find a walk buddy" button.
  The worker sends joins to Cognee; no Cognee call from web.
```

## Step 3 — Luma import (B) · community context

```text
scripts/import-luma.ts: fetch the .ics for HACK_COLLECTIVE_LUMA_CAL_ID and
import events ending after 21:00 London as study_sessions (source='luma',
luma_event_id, community = The Hack Collective). For LUMA_TONIGHT_EVENT_ID
fetch https://api.lu.ma/event/get?event_api_id=… for venue lat/lng and end
time; if hidden, use 51.4951,-0.2282 and set location_name to
'Expedite London HQ (fallback location)'. Browser User-Agent, 10 s timeout,
cache responses in .cache/, at most a few calls per minute. Idempotent upsert.
```

## Step 4 — Walk flow + live matching (A) · Supabase PostGIS + Realtime

```text
- /sessions/[id]/walk: searchable station picker (stations table), and a
  leave-time slider (now → +60 min, 5-min steps). Never ask for an address.
- Submit → rpc('request_walk'). If it returns a match id → go to the match
  card. Otherwise show "Looking for someone heading your way…" with a live
  elapsed timer, subscribe to Realtime INSERT on matches (RLS limits it to
  mine), and on insert go to the match card. After 2 min offer "Start a solo
  check-in timer instead".
- Match card (/match/[id], data from rpc('my_match')): buddy first name,
  station, "Matched in N s" (big, our 10x metric), trust reason chips,
  "N safe walks with Flock", meeting point. A Cognee reason line:
  "Checking walk history…" until matches.reason arrives via Realtime
  UPDATE; after 10 s show "Cognee reason unavailable". Buttons:
  "I'm home ✅", "I need help 🆘", "Report".
```

## Step 5 — Cognee service (B) · Cognee

```text
ai-service/ (FastAPI, Python 3.11). Pin cognee in requirements.txt and
follow its current docs for add / cognify / search.
- POST /remember {text}: cognee.add + cognify in a background task, returns
  immediately.
- POST /trust {member_a, member_b} (first names + member ids): search the
  graph for shared sessions and safe walks; return {reason, source:
  'cognee'} in one sentence a student understands. 8 s timeout → {reason:
  null, source: 'unavailable'}.
- GET /health. README section on how to run it and what LLM_API_KEY is for.
```

## Step 6 — Flock worker (B) · Supabase, Cognee, Notion, Discord

```text
bot/ (discord.js v14, @supabase/supabase-js with SERVICE ROLE,
@notionhq/client). One process, labelled logs. Copy text from
bot/messages.js (written by Grok Bot, G6).
- Realtime session_members INSERT → Cognee /remember
  "<first> studied at <session> on <date>".
- Realtime matches INSERT → Cognee /trust → update matches.reason
  (null on failure; the card shows the fallback label).
- Realtime study_sessions INSERT → create a Discord thread in
  DISCORD_SESSIONS_CHANNEL_ID, save discord_thread_id.
- Every 30 s:
  - sessions ending in ≤15 min → post the reminder + walk link once.
  - overdue_solo_trips and active matches past checkin_due_at with
    alerted_at null → insert incidents (kind missed_checkin), set
    alerted_at.
  - matches home_safe not yet remembered → Cognee /remember
    "<A> and <B> walked safely from <session> to <station> on <date>".
- Realtime incidents INSERT → Notion page in NOTION_INCIDENTS_DB_ID (Title,
  Kind, Members = first names, Session, Status open) and save
  notion_page_id → alert the session thread + DISCORD_ALERT_CHANNEL_ID.
- Every 30 s: read "Grok recommendation" from open Notion incidents and
  copy it into incidents.grok_recommendation.
- Every 60 s: upsert the Notion Tonight dashboard row per session.
- Slash command /flock → link to tonight's session walk page.
Add DISCORD_SESSIONS_CHANNEL_ID, WEB_URL to .env.example.
```

## Step 7 — Check-in, 🆘, solo timer (A) · Supabase (+ Notion, Discord via worker)

```text
- Match card ✅/🆘 → rpc('check_in').
- 🆘 screen: first line, huge: "In an emergency, call 999" (tel:999 button),
  then university security contacts (from a static list in lib/contacts.ts
  that mirrors the Notion Safety Rules page), then "Your group has been
  alerted".
- /solo/new?session=…: station + ETA minutes → rpc('start_solo').
- /solo/[tripId]: big countdown, "I'm home ✅", "I need help 🆘". When it
  hits zero: "Your session group is being alerted".
- After both buddies tap ✅: "Vouch for <first name>?" → rpc('vouch').
```

## Step 8 — Trust signals + Zero (A) · Supabase, Zero

```text
- /api/verify (route handler, service role, runs after onboard): GitHub REST
  (created_at > 1 year → +15 "GitHub since YYYY"), Devpost search (+10
  "Has shipped projects on Devpost", browser User-Agent), StopForumSpam on
  the email (hit → −100, never shown). 5 s timeout each; on failure add
  nothing and log it. Update trust_score and trust_reasons exactly as in the
  CLAUDE.md trust table.
- /api/zero (route handler): after onboard, POST to ZERO_WEBHOOK_URL with
  {first_name, community, uni_domain} only. Timeout; never block onboarding.
```

## Step 9 — Dashboard, reports, blocklist (A) · Supabase, Notion

```text
- Report button → reports row (kind, evidence required) + incidents row
  (kind 'report'), via an RPC.
- /dashboard (role 'lead' only, data via a route handler with the service
  role): tonight's sessions, walkers, matches, AVERAGE SECONDS TO MATCH as a
  huge number next to "group chat: <baseline>", missed check-ins, open
  incidents with grok_recommendation and a link to the Notion page.
- Confirm / Reject buttons (a human decides): Confirm adds the reported
  member's handle_hash to blocklist and resolves the incident; Reject
  resolves it. The worker updates the Notion status.
- Auto-refresh with Realtime on incidents and matches. Projector-sized.
```

## Step 10 — Stretch: Scam shield (B) · Grok Bot, Notion

```text
- scripts/eval-scam-filter.py: pull 500 rows of the SMS spam dataset,
  score with detoxify + keyword rules, print precision/recall.
- Bot: flag scam-like messages in session threads, draft a warning for a
  human to post, offer "Report", which creates a report + incident.
```

## Step 11 — Stretch: Safe late-night study spaces (A) · Supabase, community context

```text
- scripts/seed-study-spaces.ts: OSM Overpass amenity=library in Greater
  London (with opening_hours) → study_spaces table (RLS: read for members).
- study_space_notes table: members add a short note ("open till 2am, staff
  on door"), shown with first name only. Reports on a place go through the
  Step 9 report flow (kind 'place').
- /spaces: Leaflet map + list sorted by distance, "open late" badge from
  opening_hours, "Start a session here" button → create-session prefilled.
```

## Step 12 — Stretch: "Who do I call?" (A) · Notion, Grok Bot

```text
- /help: "In an emergency, call 999" first (tel:999), then the member's
  university security and welfare contacts.
- Contacts come from the Notion Safety Rules page (written by Grok Bot):
  /api/contacts reads it with @notionhq/client, caches for 10 min, and
  falls back to lib/contacts.ts with the label "Offline copy".
- Link to /help from the 🆘 screen, solo timer and match card.
```
