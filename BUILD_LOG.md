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
| | [grok-bot] | | |
| | [cursor] | | |

## Totals (fill in at 21:40)

- Grok Bot tasks: `__`
- Cursor commits: `__`
- Human-only changes: `__`
