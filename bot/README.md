# Flock worker (`bot/`)

One Node process on the demo laptop. It does every server-side job the web app on Vercel can't, because Vercel can't reach `localhost`. It uses the Supabase **service role** and talks to Cognee (local), Notion and Discord.

It only runs deterministic jobs. Judgment (incident recommendations against the Safety Rules) is Grok Bot's job in Notion, and a human decides.

## Setup

```bash
cd bot
npm install
# fill in bot/.env (see below); never commit it
npm start            # = node --env-file=.env index.js  (Node 20.6+)
```

Every job is **idempotent**: it is driven by `*_at` and status columns, so a restart or a re-run never double-posts. **Supabase Realtime** (`postgres_changes`) triggers jobs within about 1 s. A **polling loop** (15 s, plus 30 s for the Grok sync and 60 s for the dashboard) is the safety net. Deadlines (check-in due, solo ETA, reminder time) also get a timer, so demo alerts fire on time rather than on the next poll. Logs are labelled `HH:MM:SS [job-name] ...` in London time.

## Env (`bot/.env`)

| Var | Needed for | If missing |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | everything | worker exits with a clear message |
| `COGNEE_SERVICE_URL` | jobs 1-3 (e.g. `http://localhost:8001`) | match cards show "Cognee reason unavailable" |
| `NOTION_TOKEN` | jobs 8-11 | Notion jobs off |
| `NOTION_INCIDENTS_DB_ID` | jobs 8-10 | incidents go to Discord only |
| `NOTION_DASHBOARD_DB_ID` | job 11 | no Tonight dashboard |
| `NOTION_RULES_PAGE_ID` | startup check only (Grok Bot reads it) | check skipped |
| `DISCORD_BOT_TOKEN` | jobs 4, 5, 7b, 8, 12 | Discord off |
| `DISCORD_GUILD_ID` | `/flock` command | no slash command |
| `DISCORD_SESSIONS_CHANNEL_ID` | session threads + reminders | no threads |
| `DISCORD_ALERT_CHANNEL_ID` | alerts + escalations | alerts only in session threads |
| `WEB_URL` | links in Discord (your Vercel URL) | messages have no links |

An optional integration that's missing logs one line (e.g. `[notion] DISABLED: NOTION_TOKEN missing`) and everything else keeps running. Notion property names and types: **[`notion-schema.md`](notion-schema.md)**. All Discord copy is in **[`messages.js`](messages.js)**: first names only, 999 first for SOS, and Grok Bot may rewrite it (G6).

## Jobs

| # | Job (log tag) | Trigger → effect |
|---|---|---|
| 1 | `cognee-joins` | `session_members.remembered_at` null → Cognee `/remember` "Amara [m:..] studied at ..." → set `remembered_at` |
| 2 | `cognee-trust` | new match (`reason_source` null, < 6 h) → Cognee `/trust` (10 s timeout) → `matches.reason`, `reason_source` = `cognee` / `unavailable` |
| 3 | `cognee-safe-walks` | match `home_safe`, `remembered_at` null → Cognee `/remember` "Amara and Ben walked home safely ..." → set `remembered_at` |
| 4 | `discord-threads` | session ending in the next 24 h with no thread → public thread `<title> · ends HH:MM` + intro → `discord_thread_id` |
| 5 | `discord-reminders` | session ends within 15 min, `reminder_sent_at` null → "Heading out soon? ..." in its thread |
| 6 | `missed-walks` | active match past `checkin_due_at` → `missed_checkin` incident (first names of whoever hasn't checked in) → match `missed_checkin` + `alerted_at` |
| 7 | `overdue-solo` | `overdue_solo_trips` view → `missed_checkin` incident → trip `overdue` + `alerted_at` |
| 7b | `escalate-solo` | trip overdue for more than 10 min, `escalated_at` null → alert channel "Escalating to the society safety team: ..." |
| 8 | `incidents` | `incidents.alerted_at` null → Notion page (`notion_page_id`) + Discord session thread and alert channel (SOS includes an OpenStreetMap link; reports go only to the alert channel and name nobody) → `alerted_at` once at least one channel worked |
| 9 | `notion-resolved` | incident `resolved` in Flock → Notion `Status` = `resolved` |
| 10 | `grok-sync` | every 30 s: open Notion incidents with `Grok recommendation` → `incidents.grok_recommendation` |
| 11 | `notion-dashboard` | every 60 s: Tonight row per session (Walkers, Matches, Avg seconds to match, Missed check-ins) |
| 12 | `/flock` | slash command on the guild → "`<WEB_URL>`/sessions — find a walk buddy for tonight" |

## Discord bot

1. Discord Developer Portal → New Application → **Bot** → Reset Token → `DISCORD_BOT_TOKEN`. No privileged intents are needed (the bot reads no message content).
2. Invite it with the `bot` and `applications.commands` scopes and these permissions: **View Channels, Send Messages, Create Public Threads, Send Messages in Threads, Use Application Commands** (permissions integer `311385132032`):

   ```
   https://discord.com/oauth2/authorize?client_id=<APPLICATION_ID>&scope=bot%20applications.commands&permissions=311385132032
   ```

3. Discord → Settings → Advanced → Developer Mode. Right-click the server, the sessions channel and the alert channel → **Copy ID** → `DISCORD_GUILD_ID`, `DISCORD_SESSIONS_CHANNEL_ID`, `DISCORD_ALERT_CHANNEL_ID`. The sessions channel must be a normal text channel.

## Privacy

Every message uses first names only. No emails, member ids, handle hashes or addresses are ever posted. The SOS location link is the only location ever posted, and only for kind `help`. Member ids go only to the local Cognee service, as short `[m:xxxxxx]` tags, and are removed from any reason before it's saved. Allowed mentions are disabled, so generated copy can never ping `@everyone`.

## Check

```bash
npm run check                       # node --check on every file
node --env-file=.env index.js       # with empty Supabase vars: exits with "Supabase vars missing"
```
