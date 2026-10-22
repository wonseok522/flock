# BUILD_LOG

Evidence for judging criterion 2: **how much Grok Bot and Cursor architected it.**
One line per change. Tag = the tool that did the work. Never credit a tool for work it didn't do.

Tags: `[grok-bot]` · `[cursor]` · `[claude-code]` · `[human]`

| Time (London) | Tag | What was done | Partners used |
|---|---|---|---|
| 19:05 | [claude-code] | Wrote CLAUDE.md, README.md, schema.sql, docs (Grok Bot context, Cursor prompts, demo script) | — |
| 19:20 | [claude-code] | Initialised git, created public GitHub repo (MIT) for the team | — |
| 19:31 | [claude-code] | Audited repo + docs; wrote docs/BUILD_PLAN.md; rewrote CURSOR_PROMPTS.md (Steps 0–12) and Grok Bot jobs G1–G10; fixed demo route | — |
| 19:45 | [claude-code] | Added docs/design.md (UI tokens, components, 7 screens from the Flock UI mockups); added BUILD_PLAN.md §9 "hard to copy" ideas X1–X3 (event-native matching, Discord/WhatsApp society bot, anonymised SU walk data) | — |
| 20:15 | [claude-code] | Audited docs/design.md: Tailwind v4 tokens, `line-strong` input border (contrast 1.5 to 3.2:1), 12px tabs, neutral copy, live-location + pick-from-3 + Groups decisions, missing screens | — |
| 20:30 | [claude-code] | Rewrote supabase/schema.sql: fixed audit S1–S8 (match creation + Realtime, locked trust columns, server-side uni-domain check, RLS-safe roster RPCs, hidden overdue view), private Realtime location channels; applied as 4 migrations via Supabase MCP; supabase/test.sql passes on the live project | Supabase |
| 20:40 | [claude-code] | ai-service/: Cognee 1.6.5 FastAPI sidecar (/remember, /trust, labelled fallback); configured for Gemini (free key) | Cognee |
| 20:40 | [claude-code] | bot/: Flock worker: Realtime + polling jobs for Cognee memory/trust, Discord threads/reminders/alerts, Notion incidents + Grok recommendation sync, Tonight dashboard | Supabase, Cognee, Notion |
| 20:45 | [claude-code] | web/: Next.js 16 app: code sign-in, onboarding, Tonight, Sessions, Groups, walk matching (pick from 3, Realtime), walking-home live map + location sharing, SOS, solo timer, Safety, Safety HQ dashboard, /api/verify (GitHub, Devpost, StopForumSpam), /api/zero, /api/contacts (Notion) | Supabase, Cognee, Notion, Zero |
| 20:50 | [claude-code] | Browser-tested sign-in, onboarding, Tonight, Groups, create session against live Supabase; switched maps to darkened OSM tiles (CARTO now needs a key) | Supabase |
| 21:05 | [claude-code] | E2E-tested the walk flow with 2–3 synthetic users in headless Chrome: request, pick from 3, Realtime match on the other phone (even with polling blocked), walking-home map, check-ins, vouch, report, missed check-in incident, SOS location; fixed 5 visual issues | Supabase |
| 21:05 | [claude-code] | Docs: README run steps + architecture + partner file map, docs/SETUP.md (SMTP, Gemini, Notion, Discord, Zero, Vercel), DEMO.md rewritten for the built app, .env.example complete | — |
| 21:10 | [claude-code] | Cognee switched to free Google Gemini (gemini-3.1-flash-lite + gemini-embedding-001) with free-tier rate limiting | Cognee |
| 21:10 | [claude-code] | E2E-tested solo timer (overdue → worker incident), Safety tab, Safety HQ (confirm & block → blocklist, mark safe), Tonight/Sessions/Groups with synthetic users; added "Add 10 min" (`extend_solo` RPC), overdue count-up, incident station/due-time line, blocked users lose access to verified spaces (`am_i_blocked`), layout fixes | Supabase |
| 21:15 | [claude-code] | E2E-tested solo timer (overdue → incident), Safety tab, Safety HQ (stats, Confirm & block → blocklist, 403 for non-leads); fixed 15 UI/logic bugs incl. blocked users still seeing sessions (now lose membership), Add 10 min (`extend_solo`), dashboard states | Supabase |
| 21:15 | [claude-code] | Seeded 598 Greater London stations (OSM Overpass), tonight's hackathon event (Luma JSON), 8 synthetic demo users; scripts/ + root package.json | Supabase |
| 21:20 | [claude-code] | Hid blocked members from session rosters; Mark safe closes the walk/timer; production build passes (23 routes) | Supabase |
| 21:12 | [claude-code] | Sign-in: "I already have a code" path (works before custom SMTP is set up) | Supabase |
| 21:25 | [claude-code] | docs/FINAL_HOUR.md: paste-ready Grok Bot (G2 Notion, G5 Zero, G7 review, G9 incident review) and Cursor (study spaces, scam shield, polish) prompts | — |
| | [grok-bot] | | |
| | [cursor] | | |

## Totals (fill in at 21:40)

- Grok Bot tasks: `__`
- Cursor commits: `__`
- Human-only changes: `__`
