# 🐦 Flock

**Study together. Get home together.**

Flock is a verified community for **London university students** that makes late-night studying and events safe. Students join study sessions, find someone heading their way when it ends, and check in when they're home. If something goes wrong, their group and their society know straight away.

Built at the **Grok Bot Community Engineering London Hackathon** (22 Oct 2026) — **Wildcard track**. Built with **Grok Bot** and **Cursor**.

---

## The community

**London university students**, starting with members of **The Hack Collective**, a London community curated for university students.

## The problem

- Students study and attend events late, then **walk home alone**.
- Today the only option is asking "anyone going towards X?" in a group chat — a ~10 minute wait, often no reply, and no idea who's answering.
- Student group chats get **infiltrated by outsiders and scammers** (fake accommodation, ticket resale, phishing), and someone removed from one group simply joins the next.

## What Flock does

Flock keeps students safe at three moments:

| Moment | Feature |
|---|---|
| **Who gets into your groups** | Verified-only spaces: sign in with a university email. A blocklist is shared across communities so bad actors can't hop between groups. |
| **How you get home** | **Walk-buddy matching**: when a study session ends, Flock matches you with a verified student heading to a nearby station within 20 minutes, and explains why you can trust them. **Solo check-in timer**: if nobody's going your way, set an ETA; if you don't check in, your session group is alerted. |
| **What happens if something goes wrong** | A missed check-in or 🆘 creates an incident in the society's Notion Safety HQ. Grok Bot reviews it against the community's own safety rules and recommends an action. A human decides. |

## 10x over today

| | Today (group chat) | Flock |
|---|---|---|
| Time to find someone going your way | ~10 min, often never | < 30 seconds |
| Do you know who they are? | No | Verified student + trust reasons |
| Does anyone know you got home? | No | Check-in, with alerts if missed |
| Does a scammer removed from one group get blocked in the next? | No | Yes, shared blocklist |

## Partner integrations

| Partner | How Flock uses it |
|---|---|
| **Supabase** | Auth (university email sign-in code), Postgres + **PostGIS** for matching, **Realtime** for live matches, **RLS** on every table, shared blocklist |
| **Cognee** | Community trust graph: who studied together, who walked home safely together. Powers the "why you can trust them" reason on every match. |
| **Notion** | Society **Safety HQ**: Safety Rules page, Incidents database, Tonight dashboard |
| **Zero** | Growth: new members get a follow-up sequence; new societies enter an outreach pipeline |
| **Grok Bot** | Holds the spec and community context; set up Notion and Zero; posts session reminders in Discord; reviews incidents against Safety Rules |
| **Cursor** | Wrote the code — see [`BUILD_LOG.md`](BUILD_LOG.md) |

## Data sources

All public, all from the hackathon's Data starter kit:

- **Luma** calendar `.ics` (The Hack Collective) and event JSON — late events become study sessions; venue location and end time
- **Luma discover (London)** — how many London events end after 21:00
- **OpenStreetMap (Overpass)** — London stations as destinations (Flock never asks for a home address)
- **GitHub REST API** and **Devpost** — trust signals
- **StopForumSpam** — signup check
- **SMS spam dataset (Hugging Face)** — scam filter test set (stretch)

## Architecture

```mermaid
flowchart LR
  U[Student phone] --> W[Next.js web app<br/>on Vercel]
  W --> S[(Supabase<br/>Auth · PostGIS · Realtime · RLS)]
  W --> N1[Notion<br/>Safety Rules: uni contacts]
  W --> Z[Zero<br/>member.joined webhook]
  W --> V[GitHub · Devpost · StopForumSpam<br/>/api/verify]
  S <-->|Realtime + service role| K[Flock worker<br/>bot/ on the demo laptop]
  K --> C[Cognee ai-service<br/>localhost:8001]
  K --> N[Notion<br/>Incidents · Tonight]
  K --> D[Discord<br/>threads · reminders · alerts]
  G[Grok Bot] --> N
  G --> Z
  L[Luma · OSM Overpass] --> X[scripts/] --> S
```

**Why there is a worker.** The web app runs on Vercel, and Vercel can't reach `localhost`. Cognee runs on the demo laptop at `localhost:8001`, so the web app never calls it. Instead the **Flock worker** (`bot/`) runs on the same laptop with the Supabase service role. It listens to Supabase Realtime, calls Cognee, Notion and Discord, and writes results back to Supabase (for example `matches.reason`), which then reach the phones through Realtime. Every worker job is idempotent, so restarting it never double-posts. Grok Bot does the judgment: it reviews incidents in Notion against the Safety Rules, and a human confirms on `/dashboard`.

## Partner integrations: where to look in the code

| Partner | What it does in Flock | Code |
|---|---|---|
| **Supabase** | Email-code sign-in, uni-domain check, PostGIS matching (`find_buddies`, `request_walk`, `choose_buddy`), check-ins, blocklist, RLS on every table | [`supabase/schema.sql`](supabase/schema.sql), [`web/src/lib/supabase/`](web/src/lib/supabase), [`web/src/proxy.ts`](web/src/proxy.ts), [`web/src/app/login/login-screen.tsx`](web/src/app/login/login-screen.tsx) |
| **Supabase Realtime** | Live match on the second phone, live walk map and location pill, worker triggers | [`web/src/app/sessions/[id]/walk/walk-request-screen.tsx`](web/src/app/sessions/%5Bid%5D/walk/walk-request-screen.tsx), [`web/src/app/walk/[matchId]/walk-screen.tsx`](web/src/app/walk/%5BmatchId%5D/walk-screen.tsx), [`bot/index.js`](bot/index.js) |
| **Cognee** | Remembers session joins and safe walks; writes the "why you can trust them" line on each match | [`ai-service/main.py`](ai-service/main.py), [`bot/jobs/cognee.js`](bot/jobs/cognee.js), [`bot/lib/cognee.js`](bot/lib/cognee.js), `CogneeReason` in [`walk-screen.tsx`](web/src/app/walk/%5BmatchId%5D/walk-screen.tsx) |
| **Notion** | Incidents database, Tonight dashboard, Safety Rules (university contacts on `/safety`) | [`bot/jobs/incidents.js`](bot/jobs/incidents.js), [`bot/jobs/dashboard.js`](bot/jobs/dashboard.js), [`bot/lib/notion.js`](bot/lib/notion.js), [`bot/notion-schema.md`](bot/notion-schema.md), [`web/src/app/api/contacts/route.ts`](web/src/app/api/contacts/route.ts) |
| **Zero** | New verified member → `member.joined` webhook → follow-up sequence | [`web/src/app/api/zero/route.ts`](web/src/app/api/zero/route.ts), called from [`web/src/app/onboard/page.tsx`](web/src/app/onboard/page.tsx) |
| **Grok Bot** | Spec + community context, Notion/Zero setup, bot copy, incident recommendations (synced to `/dashboard`, a human confirms) | [`docs/GROK_BOT_CONTEXT.md`](docs/GROK_BOT_CONTEXT.md), [`bot/messages.js`](bot/messages.js), `grok-sync` in [`bot/jobs/incidents.js`](bot/jobs/incidents.js), [`web/src/app/dashboard/dashboard-screen.tsx`](web/src/app/dashboard/dashboard-screen.tsx), [`web/src/app/api/dashboard/decide/route.ts`](web/src/app/api/dashboard/decide/route.ts) |
| **Cursor** | Writes the features, one prompt per step | [`.cursor/rules/flock.mdc`](.cursor/rules/flock.mdc), [`docs/CURSOR_PROMPTS.md`](docs/CURSOR_PROMPTS.md), [`BUILD_LOG.md`](BUILD_LOG.md) |
| Discord (chat channel) | Session threads, 15-min reminders, missed check-in / SOS alerts, `/flock` | [`bot/jobs/sessions.js`](bot/jobs/sessions.js), [`bot/jobs/checkins.js`](bot/jobs/checkins.js), [`bot/lib/discord.js`](bot/lib/discord.js) |
| Trust signals | GitHub, Devpost, StopForumSpam | [`web/src/app/api/verify/route.ts`](web/src/app/api/verify/route.ts) |

## Tech stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS · shadcn/ui · Leaflet · Supabase (Postgres, PostGIS, Auth, Realtime, RLS) · Cognee (Python 3.12, FastAPI, Google Gemini) · discord.js · Notion API · Zero · Grok Bot · Cursor

## Run it locally

Full partner setup (SMTP, Notion, Discord, Zero, Vercel), each with a "how to verify" step: **[`docs/SETUP.md`](docs/SETUP.md)**. Every env var: [`.env.example`](.env.example).

```bash
git clone https://github.com/wonseok522/flock.git && cd flock
# Create web/.env.local, bot/.env and ai-service/.env from the sections of .env.example

# 1. Database (fresh project only; the team project already has it): run supabase/schema.sql,
#    then supabase/seed.sql, in the Supabase SQL editor. Then, from the repo root:
npm install                      # root: data scripts
npm run seed:stations            # OSM Overpass → stations
npm run import:luma              # The Hack Collective Luma → study_sessions
npm run seed:demo                # 8 synthetic @demo.flock.test personas (-- --reset to re-seed)

# 2. Web app, own terminal → http://localhost:3000
cd web && npm install && npm run dev

# 3. Cognee service, own terminal (Python 3.12 via uv) → http://localhost:8001/health
cd ai-service && uv venv --python 3.12 .venv \
  && uv pip install --python .venv/bin/python -r requirements.txt \
  && .venv/bin/uvicorn main:app --port 8001

# 4. Flock worker, own terminal (Node 20.6+): Cognee, Notion, Discord
cd bot && npm install && npm start
```

The scripts read `web/.env.local`. Add `-- --sql <file>` to any seed script to write idempotent SQL instead of writing to Supabase.

## Safety and privacy by design

- Destinations are **stations only** — never home addresses.
- Matches see **first names only**.
- Blocklist entries are **hashed**; no raw emails or handles are shared between communities.
- **Humans confirm** every report and block. Grok Bot only recommends.
- The 🆘 screen always says **call 999** first.
- No private member data in this repo. Seed data is synthetic.

## How it was built

Grok Bot held the spec, the safety rules and the community context, and set up Notion and Zero. Cursor wrote the code, one feature per prompt. Every step is logged with the tool that did it in [`BUILD_LOG.md`](BUILD_LOG.md).

## Licence

[MIT](LICENSE)
