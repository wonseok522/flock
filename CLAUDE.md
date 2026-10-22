# CLAUDE.md — Flock

> **Study together. Get home together.**
> Flock is a verified community for London university students that makes late-night studying and events safe.

---

## ⚠️ RULE #1 — THIS OVERRIDES EVERYTHING ELSE IN THIS FILE

**Every line of code must (a) fully use the partner integrations and (b) be written to score on the judging criteria.**

Before you start ANY feature, write one line in your response:

```
Criteria: <which of the 6 criteria this scores> | Partners: <which partners it uses>
```

- If a feature scores **no** criterion and uses **no** partner → **do not build it.** Tell me and suggest something that does.
- **All six partners must be integrated and visible in the demo:** Supabase, Cognee, Zero, Notion, Grok Bot, Cursor. If any partner is missing or mocked at any point, **flag it at the end of your reply.**
- Never fake an integration. If a partner can't be reached (missing key, API limit), build a clearly labelled fallback AND flag it.
- Every commit message starts with the tool that did the work (`[cursor]`, `[grok-bot]`, `[claude-code]`, `[human]`). Never credit Grok Bot or Cursor for work they didn't do.

### The six judging criteria (each scored 1–5)

| # | Criterion | What it means for the code |
|---|---|---|
| 1 | **Technical execution** | It works live, end to end, on real data. No dead buttons. Real Supabase RLS, PostGIS, Realtime. Handle errors and empty states. |
| 2 | **How much Grok Bot and Cursor architected it** | Grok Bot holds the spec and community context and runs the safety workflows. Cursor writes the code. Tagged commit messages prove it. |
| 3 | **Use of community context** | Use the community's own data: university email domains, The Hack Collective Luma calendar, the community's Safety Rules page in Notion, walk history in Cognee. |
| 4 | **10x–20x improvement over today's tooling** | Today: "anyone going my way?" in a group chat, ~10 min wait, no verification. Flock: verified match in <30 s with a reason. Measure and display timings. |
| 5 | **Real-world usefulness** | A student society could switch it on next week. Mobile-first. Fast. Nothing that needs explaining. |
| 6 | **Demo quality** | One clean 3-minute story. Seed data ready. Demo-safe fallbacks. Every screen readable on a projector. |

---

## Event facts

- **Grok Bot Community Engineering London Hackathon**, Thu 22 Oct 2026, Expedite London HQ, 7 Lyric Square.
- **Code freeze: 21:50 (London).** Top 5 demo live at 22:20, **3 minutes** each.
- **Track: Wildcard** — "name the community, show the problem, fix it live." A real community that would use it next week matters most.
- Must be a **public repo** with an **MIT** licence. **No private member data in the repo.**

---

## Product

**Community:** London university students, starting with members of **The Hack Collective** (a London community curated for university students). Students sign in with a university email.

**Problem:** Students study and attend events late, then walk home alone. Today they ask in a group chat and hope. Student group chats also get infiltrated by outsiders and scammers.

**Flock keeps students safe at three moments:**
1. **Who gets into your groups** → verified-only spaces (university email).
2. **How you get home** → walk-buddy matching after a study session or event, or a solo check-in timer when nobody is going your way.
3. **What happens if something goes wrong** → missed check-ins alert your session group, Grok Bot logs an incident in Notion, confirmed bad actors go on a blocklist shared across communities.

### MVP features (must ship by 21:50)

| Feature | Criteria | Partners |
|---|---|---|
| Uni-email magic-link sign-in, verified-only spaces | 1, 3, 5 | Supabase |
| Study sessions: create / join, plus late events imported from The Hack Collective Luma `.ics` | 3, 5 | Supabase, Grok Bot (Discord thread per session) |
| Walk-buddy matching (same session, destination station ≤1.5 km, leaving ≤20 min apart), live via Realtime | 1, 4, 6 | Supabase (PostGIS, Realtime) |
| Trust reasons on every match | 2, 3, 4 | Cognee, Supabase |
| Check-in after walk (✅ home safe / 🆘 need help) | 1, 5 | Supabase, Grok Bot, Notion |
| Solo check-in timer (no buddy → ETA → alert session group if overdue) | 4, 5 | Supabase, Grok Bot, Notion |
| Shared cross-community blocklist (hashed handles) | 1, 3 | Supabase (RLS) |
| Society dashboard: sessions, matches, missed check-ins, reports | 5, 6 | Supabase, Notion |
| Growth: new societies/members → Zero follow-up + outreach pipeline | 3, 5 | Zero |

### Stretch (only if MVP is done and demo-tested)

1. **Scam shield** in the Discord bot (SMS spam dataset + detoxify + StopForumSpam), with accuracy shown on a test set.
2. Safe late-night study spaces map (OSM Overpass libraries + community notes).
3. "Who do I call?" helper (999 + the university's security/welfare contacts from the Notion Safety Rules page).

---

## Tech stack (decided — don't change without asking)

| Layer | Choice | Why |
|---|---|---|
| Web app | **Next.js (latest stable, App Router) + TypeScript (strict)** | Fast to build, deploys to Vercel in one step |
| UI | **Tailwind CSS + shadcn/ui** | Clean, mobile-first, readable on a projector |
| Map | **Leaflet + react-leaflet** with OpenStreetMap tiles | Free, no API key |
| Database / auth / realtime | **Supabase**: Postgres + **PostGIS**, Auth (email magic link), **Realtime**, **RLS** | Partner; covers matching, live updates, privacy |
| Supabase client | `@supabase/ssr` + `@supabase/supabase-js` | Correct server/client auth in App Router |
| Community memory / trust graph | **Cognee** in a Python **FastAPI** sidecar (`ai-service/`) | Partner; knowledge graph of who walked safely with whom |
| Moderation (stretch) | `detoxify` in the same Python sidecar | Listed open-source starter |
| Chat channel | **Discord bot** with `discord.js` v14 (`bot/`) | Official API, full bot access (WhatsApp groups need unofficial libraries) |
| Safety HQ for organisers | **Notion API** (`@notionhq/client`) + Notion MCP for Grok Bot | Partner; incidents queue, safety rules, dashboard |
| Growth CRM | **Zero** (Luma guest sync + webhook from Flock) | Partner; member follow-ups and society outreach |
| Agent | **Grok Bot** | Partner; holds context, runs safety workflows, sets up Notion and Zero |
| Code | **Cursor** (and Claude Code as helper) | Partner; writes the code |
| Hosting | Vercel (web). Bot and ai-service run locally for the demo. | Fastest path tonight |
| Package manager | npm | No surprises |

---

## Repo layout

```
flock/
├── CLAUDE.md
├── README.md
├── LICENSE                   # MIT
├── .env.example
├── .gitignore
├── .cursor/rules/flock.mdc  # Cursor rules → points back to this file
├── docs/
│   ├── DEMO.md               # 3-minute demo script
│   ├── GROK_BOT_CONTEXT.md   # prompt pasted into Grok Bot
│   └── CURSOR_PROMPTS.md     # one Cursor prompt per build step
├── supabase/
│   ├── schema.sql
│   └── seed.sql              # synthetic demo data only
├── scripts/
│   ├── seed-stations.ts      # OSM Overpass → stations table
│   ├── import-luma.ts        # The Hack Collective .ics → study_sessions
│   └── eval-scam-filter.py   # stretch: accuracy on SMS spam dataset
├── web/                      # Next.js app
│   └── src/
│       ├── app/
│       │   ├── login/
│       │   ├── onboard/
│       │   ├── sessions/             # list + create
│       │   ├── sessions/[id]/        # session page + "find a walk buddy"
│       │   ├── sessions/[id]/walk/   # station picker, leave time, live matches
│       │   ├── solo/[tripId]/        # solo check-in timer
│       │   ├── checkin/[matchId]/
│       │   ├── dashboard/            # society/organiser view
│       │   └── api/
│       │       ├── verify/           # trust signals
│       │       ├── checkin/
│       │       ├── zero/             # forward new members to Zero webhook
│       │       └── notion/           # create incidents
│       └── lib/ (supabase, trust, hash, notion, cognee, zero)
├── bot/                      # discord.js bot
└── ai-service/               # FastAPI: Cognee (+ detoxify stretch)
```

---

## Partner integration checklist (all must be ✅ before freeze)

| Partner | Integration point | How we prove it in the demo |
|---|---|---|
| **Supabase** | Auth, PostGIS `find_buddies` RPC, Realtime on `walk_requests`, RLS on all tables, blocklist | Live match appears on a second phone without refresh |
| **Cognee** | `POST /remember` after every safe walk and session join; `POST /trust` returns the reason shown on each match card | Match card reads "You both studied at…, Sam has completed 2 safe walks…" |
| **Notion** | Safety Rules page (read by Grok Bot), Incidents database (written on missed check-in / 🆘 / report), Tonight dashboard | Incident appears in Notion live when a check-in is missed |
| **Zero** | New society → organiser outreach pipeline; new member → follow-up sequence; Luma guest sync for imported events | Show the pipeline with tonight's members in it |
| **Grok Bot** | Holds spec + community context; set up Notion and Zero; posts session reminders in Discord; reviews incidents against Safety Rules and recommends action (human decides) | Screenshot of Grok Bot doing setup + live Discord message |
| **Cursor** | Writes the features, one prompt per step | Commit messages prefixed `[cursor]` |

---

## Allowed data sources (only these)

| Source | Endpoint | Use |
|---|---|---|
| Luma calendar `.ics` | `https://api.lu.ma/ics/get?entity=calendar&id=<cal-id>` | Import late events from The Hack Collective into `study_sessions` |
| Luma single event JSON | `https://api.lu.ma/event/get?event_api_id=<evt-id>` | Venue lat/lng, end time, hosts. Tonight: `evt-lN7hh5bk7fiSQvF` |
| Luma discover (London) | `https://api.lu.ma/discover/get-paginated-events?discover_place_api_id=discplace-QCcNk3HXowOR97j&pagination_limit=50` | "Late-night London events" stat for the pitch |
| OSM Overpass | `node["railway"="station"]` in Greater London | Stations as destinations (never home addresses) |
| GitHub REST | `https://api.github.com/users/<handle>` | Trust signal: account age, repos |
| Devpost | `https://devpost.com/software/search?query=<handle>` (Accept: application/json) | Trust signal: shipped projects |
| StopForumSpam | `https://api.stopforumspam.org/api?email=<email>&json` | Signup check |
| SMS spam dataset (HF) | datasets-server rows API | Stretch: scam filter test set |

Cache responses. Keep Luma calls to a few per minute (undocumented API). Send a browser User-Agent to Devpost.

**Fallback:** if Luma hides the venue for tonight's event, use Expedite London HQ at `51.4951, -0.2282`.

---

## Trust score (explainable — every point has a reason string)

| Signal | Points | Reason string shown |
|---|---|---|
| Verified university email | +40 | "Verified UCL student" |
| GitHub account > 1 year | +15 | "GitHub since 2019" |
| Has a Devpost project | +10 | "Has shipped projects on Devpost" |
| Each completed safe walk | +10 | "2 safe walks with Flock" |
| Vouched for by someone they walked with | +15 | "Vouched for by a walk buddy" |
| StopForumSpam hit | −100 | (never shown to others; blocks matching) |
| On shared blocklist | blocked | (never matched) |

---

## Build order (time-boxed, London time)

| Time | Step | Done when |
|---|---|---|
| 19:10–19:25 | Supabase project, `schema.sql`, seed stations | `find_buddies` returns rows on seed data |
| 19:25–19:55 | Login (uni email) → onboard → sessions list/create | Can create and join a session on two phones |
| 19:55–20:25 | Walk flow: station picker, leave time, `find_buddies`, Realtime | Match appears live on second phone |
| 20:25–20:45 | Match card + `/api/verify` trust reasons + Cognee `/trust` | Card shows real reasons |
| 20:45–21:05 | Check-ins + solo timer + Notion incident + Discord bot reminders | Missed check-in creates a Notion incident |
| 21:05–21:15 | Zero webhook + dashboard + blocklist | Blocked user cannot match |
| 21:15–21:35 | **Live test with 5–10 real attendees.** Record timings. | Real matches in the DB |
| 21:35–21:50 | README, screenshots, push, submit | Public repo, MIT, submitted |

**If behind at 20:45:** keep auth, sessions, matching, check-in, blocklist. Make Cognee a single `/trust` call. Grok Bot does Notion/Zero setup in its own app; show screenshots. Never drop a partner entirely — flag instead.

---

## Coding rules

- TypeScript strict. No `any` unless commented why.
- Use `@supabase/ssr` for server components and route handlers. Never expose the service role key to the browser.
- RLS on every table. The service role is used only in route handlers and the bot.
- Mobile-first. Large tap targets. Every screen must read clearly on a projector.
- Every async action shows loading, error and empty states. No silent failures.
- Every external call has a timeout and a demo-safe fallback that is **labelled** in the UI (e.g. "trust reason unavailable").
- Small commits, prefixed with the tool that wrote them: `[cursor]`, `[grok-bot]`, `[claude-code]`, `[human]`.
- Ask before adding a new dependency that isn't in the tech stack table.

## Safety and privacy rules (non-negotiable)

- **Never collect or show home addresses.** Destinations are stations only.
- Show **first names only** to matches. No surnames, emails or phone numbers.
- Store emails/handles for the blocklist as **sha256 of the lowercased value** only.
- **A human confirms every report and every block.** Grok Bot recommends; it never bans.
- Reports are about behaviour or places, with evidence. No anonymous accusations shown publicly.
- The 🆘 screen always shows "In an emergency, call **999**" first, then university security contacts.
- **No private member data in the repo.** Seed data is synthetic. Secrets live in `.env.local` only.

## Definition of done (per feature)

1. Works on two phones on real Supabase data.
2. Uses at least one partner, named in the commit.
3. Has loading, error and empty states.
4. Appears in `docs/DEMO.md` if it's part of the demo.

## Commands

```bash
# web
cd web && npm install && npm run dev

# ai-service (Cognee)
cd ai-service && pip install -r requirements.txt && uvicorn main:app --port 8001

# bot
cd bot && npm install && node index.js

# seed
npx tsx scripts/seed-stations.ts
npx tsx scripts/import-luma.ts
```
