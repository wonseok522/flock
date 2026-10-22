# Flock: 3-minute demo script

**Story:** two students leave tonight's Hack Collective session. One is heading to **Camden Town**, the other to **Mornington Crescent** (~0.6 km apart, both a long way from the venue). Flock matches them in seconds, walks them home on a live map, and when one of them doesn't check in, the society knows straight away.

**On stage:** Phone A and Phone B (real university accounts, both already signed in, both joined the same session) under the document camera. The projector shows `/dashboard` (Safety HQ) on the laptop, with Notion **Incidents** and the Discord sessions channel in the next tabs.

| Time | Beat | What's on screen (real routes and copy) | Criteria |
|---|---|---|---|
| 0:00–0:20 | **Community + problem.** "This is for London university students, starting with The Hack Collective. We build and study late, like tonight, then walk home alone. Today's answer is 'anyone going my way?' in a group chat: about 10 minutes, no reply, and no idea who's answering." | Group chat screenshot with no reply | 3, 4 |
| 0:20–0:35 | **Verified-only.** On the laptop, type a Gmail address on `/login`: "Flock is for London university students. Use your university email..." Phones are signed in with a uni email code. Phone A on **Tonight** (`/`): the session card has the **Luma · Hack Collective** tag (imported from the community's Luma calendar). | `/login`, `/` | 3, 1 |
| 0:35–0:50 | **Grok Bot in the chat.** Discord sessions channel: the session thread `<title> · ends HH:MM` and the reminder "Heading out soon? Find someone going your way: <link>". "Grok Bot wrote this copy and holds our Safety Rules." | Discord thread | 2, 3 |
| 0:50–1:40 | **Live match.** Phone B: session → **Find a walk buddy** → "Where are you heading?" → **Mornington Crescent**, **Now** → **Find a walk buddy** → "Looking for a buddy". Phone A: **Camden Town**, **Now** → **Find a walk buddy** → "N people heading your way", "Found in N s", pick from up to 3 (seeded walkers under "Also heading your way") → card "Verified \<uni\> student" + "Why you can trust ..." → tap **Walk with \<B's name\>**. Phone B switches by itself, no refresh: "\<A\> chose to walk with you". Both show **Matched in N seconds** "vs ~10 min asking a group chat". | Two phones on camera | 1, 4, 6 |
| 1:40–2:00 | **Walking home.** Live map with the route and the location pill **Live · group can see you** ("Location is never stored"). Trust list plus the Cognee line, labelled "From your community's walk history (Cognee)". "Cognee remembers who studied together and who got home safely together." Phone A taps **I'm home**. Phone B doesn't. | `/walk/<matchId>` on both phones | 3, 1, 6 |
| 2:00–2:25 | **Something goes wrong.** Phone B taps **SOS**: "In danger? Call 999 first." with a big **Call 999** button first, then **Alert my group and society** → tap it → "Your group and society safety lead have been alerted". Within seconds: Discord "SOS from \<B\>. If anyone is with them: call 999." (plus the location link if the phone shared it), an **SOS** incident on `/dashboard`, and a page in Notion **Incidents**. | `/sos`, Discord, Notion, `/dashboard` | 1, 5, 3 |
| 2:25–2:45 | **A human decides.** `/dashboard` incident card: timeline "Discord alerted HH:MM" → Notion page; the amber card **Grok Bot recommends** with a one-line reason citing the Safety Rules. On the pre-filed report: **Confirm & block** → "Block \<name\> from Flock in every community? Only a hash of their email goes on the shared blocklist." → **Yes, block**. "Grok Bot recommends. A human decides. And a scammer removed here is blocked in every community." | `/dashboard`, Notion | 2, 3, 5 |
| 2:45–3:00 | **10x + growth + how it was built.** Dashboard hero: **Average time to a verified match** N seconds vs **Group chat today (baseline)**, "Nx faster with Flock". Zero pipeline with tonight's new members. `BUILD_LOG.md`: what Grok Bot did, what Cursor did. "Any student society can switch this on next week." | `/dashboard`, Zero, `BUILD_LOG.md` | 4, 5, 2 |

**Backup for the SOS beat:** if Phone B doesn't tap SOS, the missed check-in fires 1 minute after the leave time (demo window): Discord "Check-in missed: \<B\> hasn't confirmed they're home ..." and a **Missed check-in** incident in Notion and on `/dashboard`. Tapping SOS turns the walk into an SOS, so only one of the two fires per walk.

**If something fails live:** Cognee down → the card shows "Cognee reason unavailable" (say so: it's the labelled fallback). Discord down → incidents still reach Notion and `/dashboard`. Wi-Fi down → screenshots in `docs/evidence/`.

## Numbers to fill in before the demo

- Real matches tonight: `__`
- Average seconds to match (`/dashboard`): `__`
- Group-chat baseline measured at 21:15 (seconds, set as `GROUP_CHAT_BASELINE_SECONDS`): `__`
- Grok Bot tasks logged: `__` · Cursor commits: `__`
- London Luma events ending after 21:00 this week: `__`

## Pre-flight checklist (by 22:05)

Services on the demo laptop, each in its own terminal:

```bash
cd ai-service && .venv/bin/uvicorn main:app --port 8001   # Cognee
cd bot && npm start                                        # Flock worker
curl -s localhost:8001/health                              # → "llm_configured":true
```

- [ ] Worker log shows `[notion] Safety Rules page reachable`, no `WARN ... missing property`, no `DISABLED` lines
- [ ] Supabase SQL: `update settings set value = '1' where key = 'checkin_window_min';` (**set back to `'45'` after the demo**)
- [ ] `npm run seed:demo -- --reset` about 5 minutes before going on (seeded walkers show as "Also heading your way"; Femi stays blocked)
- [ ] Session ending soon exists (`npm run import:luma`, or create one on `/sessions/new`); Phone A and Phone B both **joined** it
- [ ] Both phones signed in with real uni accounts, location permission allowed, no open walk or timer (Safety tab says "No walk or timer running")
- [ ] Laptop account is a **lead** (SQL in `docs/SETUP.md` step 0); `/dashboard` open on the projector
- [ ] One **report** pre-filed in rehearsal (walk screen → **Report a problem** → Scam → **Send report**), and Grok Bot asked "Review open incidents in Flock Safety HQ" so its recommendation is on the card
- [ ] Discord sessions channel shows the session thread and reminder
- [ ] Notion **Incidents** and **Tonight** open in tabs; Zero pipeline open in a tab
- [ ] `ZERO_WEBHOOK_URL` tested (curl in `docs/SETUP.md` step E)
- [ ] Screenshots saved in `docs/evidence/` in case Wi-Fi fails
- [ ] Projector: browser zoom so `/dashboard` reads from the back of the room
