# Final hour: Grok Bot + Cursor tasks

Paste-ready prompts for the work left before code freeze. Each one is real partner work.

After each task:
- Screenshot it into `docs/evidence/` (no private data).
- Add one line to `BUILD_LOG.md` with the tool that did it (`[grok-bot]` or `[cursor]`).
- Cursor commits start with `[cursor]`.

---

## Grok Bot

Run these in the Grok Bot conversation that already has `docs/GROK_BOT_CONTEXT.md` pasted in.

### G2: Notion Safety HQ

```text
G2 now. In Notion, create a page "Flock Safety HQ" containing:

1. A page "Safety Rules": meet at the session location; destinations are
   stations only, never home addresses; first names only; check in within
   45 minutes of leaving; report anything that feels wrong, with evidence;
   in an emergency call 999 first, then university security. Add a heading
   "University contacts" with one bullet per London university
   ("UCL Security: <number>"). Only use numbers you can cite from the
   university's own website, and give the URL for each. If unsure, leave it
   out.

2. A database "Incidents" with EXACTLY these properties (names are
   case-sensitive):
   Title (title), Kind (select: missed_checkin, help, report),
   Members (text), Session (text), Status (select: open, resolved),
   Created (date), Grok recommendation (text).

3. A database "Tonight" with EXACTLY these properties:
   Session (title), Walkers (number), Matches (number),
   Avg seconds to match (number), Missed check-ins (number).

Then tell me how to share all three with my "Flock" integration, and give me
the three IDs.
```

The IDs go into `bot/.env` (`NOTION_RULES_PAGE_ID`, `NOTION_INCIDENTS_DB_ID`, `NOTION_DASHBOARD_DB_ID`) and `web/.env.local` (`NOTION_RULES_PAGE_ID`). The token comes from step C of `docs/SETUP.md`. Restart the worker afterwards.

**To verify:** the worker log shows `[notion] Safety Rules page reachable`, with no missing-property warnings.

### G5: Zero

```text
G5 now. In Zero:
(a) Create a follow-up sequence "New Flock member": day 0 "Welcome to
    Flock. Your study sessions are verified-only."; day 1 "Got home safe
    last night? Join tonight's study session on Flock."
(b) Create a pipeline "London student societies" with stages
    Identified → Invited → Onboarded. Add the hosts of late-night London
    student events from the Luma discover feed as Identified, each with a
    drafted invite: "Your members study late too. Flock gives your society
    verified walk-home buddies and a safety dashboard. Switch it on next
    week?"
(c) Create an incoming webhook that adds each new member to (a), and give me
    its URL. The payload is
    {"event":"member.joined","first_name","community","uni_domain","joined_at"}.
```

The URL goes into `web/.env.local` as `ZERO_WEBHOOK_URL`. Restart `npm run dev`.

**To verify:** onboard a new test user, and they appear in the Zero sequence.

### G9: incident review (live in the demo)

Before running it, create an incident by pressing SOS on a test walk, or by letting a test check-in lapse. Then wait about 30 s for the worker to create the Notion page.

```text
G9 now. Review every open incident in Flock Safety HQ → Incidents against
the Safety Rules page. For each one, write into its "Grok recommendation"
property: confirm / reject / follow up, plus one line that cites the rule.
Never block anyone yourself. A human decides on the Flock dashboard.
```

**To verify:** within 30 s the recommendation appears on the incident's amber card on `/dashboard`.

### G7: safety review of a Cursor change

```text
G7 now. Review this diff against Flock's safety rules: no home addresses,
first names only, no raw emails or handles, no service-role key in browser
code, every external call has a timeout and a labelled fallback. List any
violations with file and line, or say it's clean.

<paste the output of: git show --stat -p HEAD>
```

---

## Cursor

Use Agent mode with Claude Opus 5.5. `.cursor/rules/flock.mdc` loads CLAUDE.md automatically. Run one prompt per task.

### Cursor task 1: safe late-night study spaces (Step 11)

```text
Read CLAUDE.md, docs/design.md and docs/CURSOR_PROMPTS.md Step 11.
Start your reply with "Criteria: ... | Partners: ...".

Build "safe late-night study spaces":
1. supabase/migrations/2026-10-22-study-spaces.sql (also append the same SQL
   to supabase/schema.sql): table study_spaces (id bigint pk = OSM id, name,
   location geography(point,4326), opening_hours text); RLS on, select for
   authenticated; a security-definer RPC
   nearby_study_spaces(p_lat, p_lng) returning id, name, lat, lng,
   distance_m and opening_hours, the 30 nearest, with search_path
   public, extensions.
2. scripts/seed-study-spaces.ts following scripts/seed-stations.ts and
   scripts/lib.ts: Overpass amenity=library in Greater London. Supports
   --sql like the other scripts. Add "seed:study-spaces" to the root
   package.json.
3. web/src/app/spaces/page.tsx + spaces-screen.tsx: Suspense page pattern
   like the other screens; useMember(); FlockMap of nearby spaces from the
   user's location (fallback: the session location) and a list sorted by
   distance. Show an "Open late" badge when opening_hours mentions a time
   after 22:00. Add a "Start a session here" button → /sessions/new
   prefilled via ?lat=&lng=&place=. Loading, empty and error states.
   Design tokens only.
4. Link it from the Safety tab ("Safe places to study late").
Run npx tsc --noEmit and npx eslint src in web/, then fix everything.
```

A human applies the migration in the Supabase SQL editor and runs `npm run seed:study-spaces`.

### Cursor task 2: scam shield evaluation (Step 10)

```text
Read CLAUDE.md and docs/CURSOR_PROMPTS.md Step 10.
Start your reply with "Criteria: ... | Partners: ...".

Create scripts/eval-scam-filter.py. Pull 500 rows of the SMS spam dataset
from the Hugging Face datasets-server rows API (allowed source in CLAUDE.md;
cache the response in .cache/). Score each message with a keyword + URL +
urgency rule set (no new dependencies; detoxify is optional only if it's
already installed). Print precision, recall, F1 and a confusion matrix, and
save the results to docs/evidence/scam-filter-eval.md. Then add a
bot/lib/scam.js using the same rules, and make the worker flag scam-like
messages in session threads by drafting a warning for a human to post
(never auto-delete or ban). Log the accuracy line in BUILD_LOG.md.
```

### Cursor task 3: polish pass

```text
Read docs/design.md. Open every screen at 390×844 and fix anything that
doesn't match it: spacing, one amber primary per screen, red only for
emergencies, 24h London times, no text overflow. Don't change behaviour.
Commit as [cursor] with a list of what you changed.
```
