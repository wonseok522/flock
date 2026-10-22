# Flock — build plan

> Audit + step-by-step plan for the full app: every feature in CLAUDE.md, MVP and stretch. **Which features ship is the team lead's call.** This plan cuts nothing.
> Repo today: docs + `supabase/schema.sql` only. `web/`, `bot/`, `ai-service/`, `scripts/`, `seed.sql` do not exist yet.
> Prompts to paste: [`CURSOR_PROMPTS.md`](CURSOR_PROMPTS.md). Grok Bot context: [`GROK_BOT_CONTEXT.md`](GROK_BOT_CONTEXT.md). Demo: [`DEMO.md`](DEMO.md).

---

## 1. Audit — what's wrong today

### 🔴 Blockers in `schema.sql` (Cursor fixes these in Step 0)

| # | Problem | What breaks | Fix |
|---|---|---|---|
| S1 | Phones subscribe to `walk_requests`, but RLS only lets you see **your own** requests. Realtime respects RLS. Nothing ever inserts into `matches` (no policy, no function). | **The live match never appears on the second phone.** This is the core demo beat. | `request_walk()` security-definer RPC: inserts the request, picks the best candidate, **creates the match** and marks both requests matched in one transaction. Phones subscribe to `matches`, which participants can read. |
| S2 | `"update own profile"` covers every column. | Anyone can set their own `trust_score = 999` or change `handle_hash` to dodge the blocklist. | Revoke insert/update on `members` from `authenticated`; grant update only on safe columns. Onboarding goes through an `onboard()` RPC. |
| S3 | The university-domain check exists only in the UI. | Anyone can sign up with Gmail through the Supabase API. That undoes "verified-only spaces". | `onboard()` reads the email from `auth.users`, rejects domains not in any `communities.allowed_email_domains`, and adds the member to `community_members`. |
| S4 | `trust_score` defaults to 0 and `find_buddies` requires `> 0`. | Nobody matches unless `/api/verify` has already run. | `onboard()` grants +40 "Verified <uni> student" immediately. |
| S5 | `members` and `session_members` are readable only by their owner. | Session member count and the buddy's first name can't be shown. | Security-definer `session_roster()` and `my_match()` functions return **first name + trust reasons only**. |
| S6 | The `overdue_solo_trips` view runs as its owner and is exposed through the API. | Any user can read **every** solo trip (privacy leak). | `revoke all ... from anon, authenticated`; only the worker (service role) reads it. |
| S7 | `matches` has no `checkin_due_at` / `alerted_at`. | The worker re-alerts every minute and can't detect a missed check-in. | Add both columns, plus `members.safe_walks` and `incidents.grok_recommendation`. |
| S8 | No seed data: communities, organiser role, demo users, blocked account. | Nothing to demo, and `/dashboard` has no lead. | `seed.sql` + `scripts/seed-demo.ts` (synthetic users via the admin API, `@demo.flock.test`). |

### 🔴 Deployment blockers (humans fix these, 10 min total)

| # | Problem | Fix |
|---|---|---|
| D1 | Supabase's built-in email **only delivers to project team members** and is rate-limited. The 21:15 live test with attendees will fail. | Supabase → Auth → SMTP: a Gmail app password (5 min). Add `{{ .Token }}` to the magic-link email template so students can **type the 6-digit code** on their phone (a link opened in a mail app's in-app browser signs in the wrong browser). Add the Vercel URL to Auth → Redirect URLs. |
| D2 | Web is on Vercel and Cognee runs on a laptop at `localhost:8001`. **Vercel can't reach localhost.** | `bot/` becomes the local **Flock worker**. It listens to Supabase Realtime with the service role, calls Cognee locally and writes the reason back to `matches.reason`, which then reaches the phones through Realtime. Web never calls localhost. Notion and Discord calls go through the worker too. |
| D3 | Cognee `cognify`/`search` take seconds and need an LLM key. A slow `/trust` call would wreck the "< 30 s" claim. | The match card renders immediately with Supabase trust reasons; the Cognee reason streams in. After 10 s it shows the label **"Cognee reason unavailable"**. |

### 🟠 Doc conflicts (already fixed in the docs)

- **Who runs Discord?** The Grok Bot context gave Grok Bot runtime Discord duties; the Cursor prompts gave them to `bot/`. **Decision:** deterministic jobs (threads, reminders, alerts) belong to `bot/`, written by Cursor. Judgment calls (incident recommendations against Safety Rules, scope cuts, copy) belong to **Grok Bot**.
- **DMs need `discord_user_id`, which nobody collects.** Alerts go to the session thread (first names only) and the alert channel instead.
- `seed-stations.ts` sat in Cursor Step 2 but is needed for Step 0. It's moved.
- `FLOCK_ALLOWED_EMAIL_DOMAINS` duplicates `communities.allowed_email_domains`. **The DB is the source of truth**; the env var is used only by the seed.
- The Notion **Tonight dashboard** had no writer. The worker now upserts it once a minute.
- **Vouching (+15)** is in the trust table but had no flow. It's now in Step 7 (after both members check in ✅).
- **Stretch 2 and 3** (safe study spaces map, "Who do I call?" helper) had no Cursor prompt. They're added as Steps 11–12.
- **Demo route was weak:** the venue is beside Hammersmith station, so Hammersmith ↔ Ravenscourt Park is a 3-minute walk. `DEMO.md` now uses **Camden Town + Mornington Crescent** (~0.6 km apart, far from the venue): "travelling home the same way".
- The **"~10 min" baseline is unsourced**, so measure it tonight. At 21:15, post "anyone heading to Camden?" in a real group chat and time the first reply. Show both numbers.
- `HACK_COLLECTIVE_LUMA_CAL_ID` is blank. This is a Grok Bot task (G3).
- Demo needs a missed check-in **inside 3 minutes**, so add `CHECKIN_WINDOW_MIN` (demo: `1`, real: `45`).
- Next.js 16+ renamed `middleware.ts` to `proxy.ts`. Cursor should follow the current `@supabase/ssr` docs for whichever version `create-next-app` installs.
- `BUILD_LOG.md` repo-creation time was logged in KST. It's corrected to London time.

### ⚠️ Decisions that differ from CLAUDE.md (your OK needed)

1. **Sign-in email shows a 6-digit code as well as the link** (still Supabase Auth, no stack change).
2. **`bot/` is also the worker** that calls Cognee and Notion. CLAUDE.md implies `web/lib/cognee` calls Cognee directly, but D2 makes that impossible on Vercel.
3. **Check-ins use a Supabase RPC** instead of `/api/checkin`. That's one less moving part.

---

## 2. Architecture after the fixes

```
 Student phone ──► Next.js on Vercel ──► Supabase (Auth · PostGIS RPCs · Realtime · RLS)
                        │                        ▲   │ Realtime (service role)
                        │                        │   ▼
                        │                  Flock worker  (bot/, on the demo laptop)
                        │                   ├─► Cognee  ai-service :8001  (/remember, /trust)
                        │                   ├─► Notion  Incidents + Tonight dashboard
                        │                   └─► Discord session threads, reminders, alerts
                        ├─► Zero webhook (new member)
                        └─► GitHub · Devpost · StopForumSpam (/api/verify)

 Grok Bot ──► Notion (MCP): Safety HQ setup, Safety Rules, recommendation on every incident
          ──► Zero: follow-up sequence + "London student societies" pipeline
          ──► Team: spec holder, diff reviewer, 20:45 scope gate
```

| Event | Path | Partners |
|---|---|---|
| Join session | `session_members` insert → worker → Cognee `/remember` | Supabase, Cognee |
| Request walk | `request_walk()` → `matches` row → Realtime on **both** phones (< 1 s) | Supabase PostGIS + Realtime |
| Trust reason | worker sees match → Cognee `/trust` → `matches.reason` update → Realtime | Cognee, Supabase |
| Both ✅ | `check_in()` → `safe_walks + 1`, `trust +10` → worker → Cognee `/remember` safe walk | Supabase, Cognee |
| 🆘 / overdue solo / missed check-in | `incidents` row → worker → Notion page + Discord thread alert | Supabase, Notion, Discord |
| Recommendation | Grok Bot reads the incident in Notion against Safety Rules → writes recommendation → worker syncs it to Supabase → lead clicks **Confirm** on `/dashboard` → `blocklist` | Grok Bot, Notion, Supabase |
| New member | onboard → `/api/zero` → Zero follow-up | Zero |

---

## 3. Who does what

Each person drives **their own Cursor window in their own folders**, so there are no merge conflicts. With two people, merge roles B and C.

| Role | Owns | Tool |
|---|---|---|
| **A — Web** | `web/` | Cursor |
| **B — Data + worker** | `supabase/`, `scripts/`, `bot/`, `ai-service/` | Cursor |
| **C — Partners + demo** | Notion, Zero, Discord server, Luma IDs, evidence, `docs/DEMO.md` | **Grok Bot** |

---

## 4. Build order

Phases run in order. Within a phase, the three roles work in parallel. Don't start the next phase until the checkpoint passes.

| Phase | A — Web (Cursor) | B — Data + worker (Cursor) | C — Partners + demo (Grok Bot) | ✅ Checkpoint |
|---|---|---|---|---|
| **1. Foundation** | **Step 1** scaffold, auth, onboard, deploy to Vercel | Create the Supabase project (human). **Step 0** schema fixes + seeds; run them | G1 paste context · G2 Notion Safety HQ · G3 Luma cal ID + venue · D1 SMTP + redirect URLs (human) | `request_walk` matches two seed users in `test.sql` |
| **2. Sessions** | **Step 2** sessions list / create (map picker) / join | **Step 3** Luma import · **Step 5** Cognee ai-service | G4 demo personas · G5 Zero setup · create Discord server + bot token | Two real phones sign in and join the same session |
| **3. Matching** | **Step 4** walk flow, Realtime, match card | **Step 6** worker: Realtime → Cognee, Discord threads/reminders, Notion incidents | G6 Discord copy · G7 review each Cursor diff | **Match appears live on phone 2 with a Cognee reason** |
| **4. Safety loop** | **Step 7** check-in, 🆘, solo timer, vouching | Step 6 continued: missed check-in → Notion; Grok recommendation sync; Tonight dashboard | G8 progress check with Grok Bot · G9 rehearse the incident review in Notion | Missed check-in → Notion incident appears live |
| **5. Trust, growth, admin** | **Step 8** `/api/verify` + `/api/zero` · **Step 9** dashboard, report, blocklist | Help A; harden worker error handling | Blocked test account ready; Zero pipeline shows new members | Blocked user gets no match; new member appears in Zero |
| **6. Stretch** | **Step 11** safe study spaces map · **Step 12** "Who do I call?" helper | **Step 10** scam shield | Grok Bot supplies the university contacts from the Notion Safety Rules page | Each works on two phones |
| **7. Live test** | **5–10 real attendees** | Watch worker logs; record `seconds_to_match` | Time the group-chat baseline; screenshots | Real matches in the DB |
| **8. Ship** | README numbers | BUILD_LOG totals | G10 Grok Bot drafts the pitch numbers; push; **submit** | Public repo, MIT, submitted |
| **9. Rehearse** | Run `DEMO.md` twice on the projector | | | |

---

## 5. Using Grok Bot to the full (criterion 2)

**Screenshot every Grok Bot turn** into `docs/evidence/` (no private data) and log it as `[grok-bot]`. If Grok Bot can't act in a tool directly, a human clicks through its instructions and logs `[human] (spec from grok-bot)`. Be honest about who did what.

| ID | Job | Output |
|---|---|---|
| G1 | Paste `GROK_BOT_CONTEXT.md`; ask it to restate the plan as a task board | Task board screenshot |
| G2 | Create Notion **Flock Safety HQ**: Safety Rules page, Incidents DB, Tonight DB | 3 IDs → `.env.local` |
| G3 | Find The Hack Collective Luma calendar ID; read tonight's event JSON (venue lat/lng, end time) | `HACK_COLLECTIVE_LUMA_CAL_ID`, venue |
| G4 | Write 8 **synthetic** demo personas: first name, uni, destination station, leave time; one marked as the blocked account | Cursor turns these into `seed-demo.ts` |
| G5 | Zero: new-member follow-up sequence + "London student societies" pipeline from Luma hosts of late events | `ZERO_WEBHOOK_URL`, pipeline screenshot |
| G6 | Write bot copy: thread intro, 15-minute reminder, missed-check-in alert, 🆘 alert (first names only) | Pasted into `bot/messages.js` |
| G7 | **Review each Cursor diff** against the CLAUDE.md safety rules (addresses, surnames, raw emails, service key in browser) | Review notes → fixes |
| G8 | **Progress check:** paste each checkpoint result; Grok Bot compares it with the spec, lists gaps and partner coverage. The team lead decides scope. | Status screenshot |
| G9 | **Live in the demo:** "Review open incidents in Flock Safety HQ against our Safety Rules" → writes a recommendation into the incident. A human confirms on `/dashboard`. | The demo's Grok Bot beat |
| G10 | Draft the README "Results" section and the BUILD_LOG totals from real numbers | Final docs |

## 6. Using Cursor to the full (criterion 2)

- `.cursor/rules/flock.mdc` loads CLAUDE.md automatically. Paste **one** prompt from `CURSOR_PROMPTS.md` per step, in Agent mode.
- Every Cursor reply starts with `Criteria: … | Partners: …`. Keep those screenshots as evidence.
- Commit right after each step passes: `git commit -m "[cursor] Step N: …"`, plus one `BUILD_LOG.md` line. Pull before pushing.
- When a human fixes Cursor's code, commit it as `[human]`. When Claude Code helps, commit it as `[claude-code]`. The log must be truthful.
- Ask Cursor to write the SQL that checks its own RPCs (Step 0). Tested RPCs prevent the "it doesn't match" panic at 21:15.

## 7. Partner coverage by step

| Partner | Steps |
|---|---|
| Supabase | 0, 1, 2, 4, 7, 8, 9 |
| Cognee | 2 (via worker), 5, 6, 7 |
| Notion | 6, 9, 12 |
| Zero | 8 (+ G5) |
| Grok Bot | G1–G10, incident recommendations (6, 9), bot copy (6), contacts (12) |
| Cursor | every step |

## 8. Demo evidence checklist

- [ ] `BUILD_LOG.md`: every step tagged; totals filled in
- [ ] `docs/evidence/`: Grok Bot setup, Notion HQ, Zero pipeline, Cursor `Criteria:` replies
- [ ] Real numbers in `DEMO.md`: matches tonight, average seconds to match, group-chat baseline
- [ ] Worker and ai-service running on the demo laptop; fallback labels visible if they stop

---

## 9. What makes Flock hard to copy

SafeUP (the closest existing app) reached ~100k users but its guardian networks stayed patchy outside Israel: strangers spread across a whole city, and nobody nearby when you need them. These three ideas fix that density problem by riding on the community, which is exactly what the judges score ("use of community context", "10x over today's tooling"). As with the rest of this plan, **which of these ship is the team lead's call.**

| # | Idea | Why it's hard to copy |
|---|---|---|
| X1 | Event-native matching | Matching starts from a shared event, not a stranger's location |
| X2 | Bot in society Discord + WhatsApp chats | No app download; lives where students already talk |
| X3 | Anonymised walk-home data for the SU | Turns Flock from "an app" into community infrastructure |

### X1. Event-native matching

Don't wait for someone to feel unsafe and open the app. When an event ends, Flock **proactively** asks "Heading home?" and groups people who were at the same event.

- **Trigger:** session `ends_at` (from the Luma import in Step 3, plus SU calendar and library closing times) minus 10 minutes.
- **What the student sees:** a push / in-app card: *"Late study ends 23:30. 5 people are heading north. Leave together at 23:35?"* One tap calls `request_walk()`.
- **Matching rule:** prefer candidates from the **same session** first, then the same community, then anyone verified. The shared session becomes the first trust reason ("At Late study with you tonight").
- **Builds on:** Step 2 (sessions), Step 3 (Luma import), Step 4 (walk flow), Step 6 (worker schedules the nudge).
- **Partners:** Supabase (sessions, `request_walk`), Cognee (same-session edge), Luma data.
- **Demo line:** "Nobody has to ask. The event ending *is* the request."

### X2. A bot that lives in society chats (Discord + WhatsApp)

Students already ask "anyone going towards X?" in group chats. Put Flock **in** those chats instead of asking them to switch apps.

**Flow (both platforms):**
1. Event ends → bot posts in the society's chat: *"Jazz Night's wrapping up. Who's heading home? React / reply with your station."*
2. Students react or reply with a station → bot groups them by direction using the same `request_walk()` RPC.
3. Bot replies with the group (**first names only**) and a link to the web app for live check-in.
4. Once everyone taps ✅ "home", the bot closes the group. A missed check-in posts a nudge in the thread and raises an incident (same path as Step 7).

**Discord** (primary, fully supported)
- Official Discord API via `discord.js` in `bot/` (the worker already owns Discord per the doc-conflicts decision).
- Use a thread per event, reactions or a `/heading <station>` slash command, and buttons for ✅ check-in.
- Linking: `/link` command sends a magic link that ties `discord_user_id` to the verified Flock member. Unlinked users are told to verify first and are never matched.

**WhatsApp** (stretch, most UK student societies live here)
- **Official Cloud API:** free to start, but it only talks 1:1 with people who message a business number, outbound messages need approved templates, and group support is limited. Use it for 1:1: a student messages the Flock number "home Camden" → gets matched → gets check-in prompts.
- **Group bots** need an unofficial library (Baileys / whatsapp-web.js). These are **against WhatsApp's terms**, so only use a spare test number for the demo and say so honestly. Don't ship it to real societies.
- Same rules as Discord: verified members only, first names only, stations not addresses.

- **Builds on:** Step 6 (worker + Discord threads), Step 7 (check-ins), G6 (bot copy from Grok Bot).
- **Partners:** Supabase, Grok Bot (writes the bot copy and posts session reminders), Discord / WhatsApp from the hackathon integrations list.
- **Demo line:** "Zero downloads. It shows up in the chat your society already uses."

### X3. Walk-home data for the student union

Every matched walk and check-in is a data point about where and when students travel home late. Aggregated, it's evidence the SU can take to the university.

- **What it shows:** a heatmap of late-night walks by **departure venue → destination station** and **hour**, plus counts of solo walks and missed check-ins.
- **Privacy rules (non-negotiable):**
  - Stations and venues only, never routes between them or home addresses.
  - Aggregate only; hide any cell with **fewer than 5 walks** so no one is identifiable.
  - No names, no member IDs, no incident details in the export.
- **Where it lives:** a new tab on `/dashboard` for organisers + a weekly CSV/Notion page the society can forward to the SU.
- **Use cases:** argue for better lighting on a busy route, later library shuttles, security patrols at specific times, or a later SU night bus.
- **Builds on:** Step 9 (dashboard), Notion Tonight dashboard (worker).
- **Partners:** Supabase (aggregate view, service role only, same treatment as S6), Notion (weekly report page), Grok Bot (writes the weekly summary from the numbers).
- **Demo line:** "Every walk home makes the next one safer, because the SU can finally see where students need help."

### Build order for X1–X3

| Phase | Add |
|---|---|
| 3. Matching | X1 nudge from the worker when a session is ending |
| 4. Safety loop | X2 Discord: event thread, `/heading`, ✅ buttons, missed check-in nudge |
| 5. Trust, growth, admin | X3 aggregate view + dashboard tab |
| 6. Stretch | X2 WhatsApp 1:1 via Cloud API (group bot only on a test number) |
