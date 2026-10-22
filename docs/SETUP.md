# Flock setup: partners, click by click

Every step ends with **Verify**. Do them in order; the whole thing takes about 30 minutes. Env var names and the file each belongs in: [`.env.example`](../.env.example). Never paste a secret into chat, a commit, a screenshot or a Notion page.

| Step | Who | Unblocks |
|---|---|---|
| [0. Env files + Supabase keys](#0-env-files-and-supabase-keys) | human | everything |
| [A. Supabase Auth: SMTP, email template, URLs](#a-supabase-auth-smtp-email-template-redirect-urls) | human | sign-in for anyone who isn't a Supabase team member |
| [B. Gemini key for Cognee](#b-gemini-key-for-cognee) | human | real trust reasons on match cards |
| [C. Notion Safety HQ](#c-notion-safety-hq) | Grok Bot (G2) + human | incidents, Tonight dashboard, uni contacts |
| [D. Discord bot](#d-discord-bot) | human | session threads, reminders, alerts |
| [E. Zero webhook](#e-zero-webhook) | Grok Bot (G5) + human | new-member follow-ups |
| [F. Vercel](#f-vercel) | human | phones on the venue Wi-Fi |
| [G. Demo settings](#g-demo-settings) | human | missed check-in inside the 3-minute demo |

---

## 0. Env files and Supabase keys

Supabase project ref: `itzifxfdpziwpkpnvyji` (schema and seed already applied; `supabase/schema.sql` and `supabase/seed.sql` mirror it).

1. Supabase dashboard → your project → **Project Settings → API Keys**. Use the **Legacy API Keys** tab: copy `anon` and `service_role`. The project URL is `https://itzifxfdpziwpkpnvyji.supabase.co`.
2. Create three files from the sections of `.env.example` (all gitignored):
   - `web/.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, ...
   - `bot/.env`: `SUPABASE_URL` (same URL), `SUPABASE_SERVICE_ROLE_KEY`, `COGNEE_SERVICE_URL=http://localhost:8001`, ...
   - `ai-service/.env`: the Gemini block (step B).
3. Seed from the repo root: `npm install && npm run seed:stations && npm run import:luma && npm run seed:demo`.

**Verify:** `npm run seed:stations` ends with a count of stations upserted. `cd bot && npm start` prints no `Supabase vars missing` line. In Supabase → Table Editor, `stations` and `study_sessions` have rows.

**Make yourself a Safety HQ lead** (needed to open `/dashboard`). Sign in once on the app with your university email, then run in Supabase → **SQL Editor**:

```sql
update community_members set role = 'lead'
where member_id = (select id from auth.users where email = '<your-uni-email>')
  and community_id = (select id from communities where name = 'The Hack Collective');
```

**Verify:** `/dashboard` shows "Average time to a verified match" instead of "Only society safety leads can open Safety HQ".

---

## A. Supabase Auth: SMTP, email template, redirect URLs

Supabase's built-in email sender only delivers to members of the Supabase project team, and only a few per hour. Real students at the live test need custom SMTP.

### A1. Gmail app password (5 min)

1. Use a Gmail account the team controls (a fresh one like `flock.demo.xxx@gmail.com` is fine).
2. Google Account → **Security** → **2-Step Verification** (turn it on if it's off).
3. In 2-Step Verification, scroll to **App passwords** (or open https://myaccount.google.com/apppasswords) → name it `Flock Supabase` → **Create**. Copy the 16-character password. You only see it once.

### A2. Supabase SMTP settings

Supabase → **Authentication → Emails → SMTP Settings** → turn on **Enable custom SMTP**:

| Field | Value |
|---|---|
| Sender email | the Gmail address |
| Sender name | `Flock` |
| Host | `smtp.gmail.com` |
| Port | `465` (SSL). If it fails, use `587` (STARTTLS) |
| Minimum interval between emails | leave the default |
| Username | the Gmail address |
| Password | the app password from A1 (not the Gmail login password) |

Save. Then **Authentication → Rate Limits** → raise **Rate limit for sending emails** (custom SMTP starts at 30/hour) to about 100/hour for the live test.

### A3. Email template with the code

Flock signs students in by **typing the code** from the email (a link opened inside a mail app's in-app browser signs in the wrong browser). This project sends **8-digit codes** (Authentication → Providers → Email → **Email OTP Length**). The login screen accepts 6 to 8 digits.

Supabase → **Authentication → Emails → Templates**. Edit **Magic Link**, and paste the same body into **Confirm signup** too (a student's very first sign-in can use that template):

- Subject: `Your Flock sign-in code: {{ .Token }}`
- Body (Source / HTML):

```html
<h2>Your Flock sign-in code</h2>
<p>Type this code on the Flock sign-in screen:</p>
<p style="font-size:32px;font-weight:700;letter-spacing:6px;font-family:monospace">{{ .Token }}</p>
<p>It expires in 1 hour. If you didn't ask for it, ignore this email.</p>
<p>On the same device? You can also <a href="{{ .ConfirmationURL }}">sign in with this link</a>.</p>
<p style="color:#666">Flock: study together, get home together. Verified London university students only.</p>
```

### A4. URL configuration

Supabase → **Authentication → URL Configuration**:

- **Site URL**: your Vercel URL (e.g. `https://flock-xxxx.vercel.app`). Before Vercel exists, use `http://localhost:3000` and change it after step F.
- **Redirect URLs** → Add URL, one per line:
  - `http://localhost:3000/**`
  - `https://<your-vercel-url>/**`

**Verify:** open `http://localhost:3000/login` on a phone or laptop, enter a university email that is **not** on the Supabase team → **Check your email** screen → the email arrives from "Flock" within a minute and shows the code → type it → you land on onboarding ("What should we call you?"). A non-university email (e.g. Gmail) is rejected with "Flock is for London university students...". If no email arrives: Supabase → **Logs → Auth** shows the SMTP error (usually a wrong app password or port).

---

## B. Gemini key for Cognee

1. Open https://aistudio.google.com/apikey → **Create API key** (free tier is enough). Copy it.
2. In `ai-service/.env`:

   ```
   LLM_API_KEY=<the key>
   LLM_PROVIDER=gemini
   LLM_MODEL=gemini/gemini-3.1-flash-lite
   EMBEDDING_PROVIDER=gemini
   EMBEDDING_MODEL=gemini/gemini-embedding-001
   EMBEDDING_DIMENSIONS=768
   EMBEDDING_API_KEY=${LLM_API_KEY}
   ```

3. Start it: `cd ai-service && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt && .venv/bin/uvicorn main:app --port 8001`

**Verify:**

```bash
curl -s localhost:8001/health
# {"ok":true,"cognee_version":"1.6.5","llm_configured":true}
```

`llm_configured: false` means the key wasn't read; check the file is `ai-service/.env`. Then start the worker (`cd bot && npm start`) and join a session in the app: the worker logs `[cognee-joins] remembered: <name> joined "<session>"`. After a match, the card shows a line labelled "From your community's walk history (Cognee)". The first cognify takes a few seconds; until it has run, cards show the labelled fallback "Cognee reason unavailable".

---

## C. Notion Safety HQ

### C1. Integration and token (human, 2 min)

1. Open https://www.notion.so/profile/integrations → **New integration**.
2. Name `Flock`, pick the workspace, type **Internal** → Save.
3. **Capabilities**: Read content, Update content, Insert content. Save.
4. Copy the **Internal Integration Secret** (`ntn_...`). Put it in **both** `bot/.env` and `web/.env.local` as `NOTION_TOKEN` (and in Vercel later).

### C2. Grok Bot creates the Safety HQ (G2)

Paste [`GROK_BOT_CONTEXT.md`](GROK_BOT_CONTEXT.md) into Grok Bot and run **G2**. It creates a page **Flock Safety HQ** with three children. The property names are case-sensitive and must match [`bot/notion-schema.md`](../bot/notion-schema.md) exactly:

**Safety Rules** (normal page): the rules, then a **heading whose text contains "University contacts"** followed by one bullet per contact, written `Name — number`, e.g. `UCL Security — <number from ucl.ac.uk>`. `/safety` reads the bullets under that heading. Check every number against the university's own website; never let a made-up number in.

**Incidents** (database):

| Property | Type | Options |
|---|---|---|
| `Title` | Title | rename Notion's default `Name` to `Title` |
| `Kind` | Select | `missed_checkin`, `help`, `report` |
| `Members` | Text | |
| `Session` | Text | |
| `Status` | Select | `open`, `resolved` (lowercase) |
| `Created` | Date | |
| `Grok recommendation` | Text | Grok Bot writes this (G9) |

**Tonight** (database):

| Property | Type |
|---|---|
| `Session` | Title (rename `Name` to `Session`) |
| `Walkers` | Number |
| `Matches` | Number |
| `Avg seconds to match` | Number |
| `Missed check-ins` | Number |

If Grok Bot can't create them directly, it gives click-by-click steps; a human does them and commits with `[human] (spec from grok-bot)`.

### C3. Share with the integration and copy the IDs

1. Open **Flock Safety HQ** → **•••** (top right) → **Connections** → **Add connection** → **Flock** → Confirm. The three children inherit access. (If they live elsewhere, do this on each of the three.)
2. Copy IDs from the URL (open a database **as a full page**, not inline):
   - Page: `notion.so/Safety-Rules-`**`1a2b3c...`** (the last 32 hex characters) → `NOTION_RULES_PAGE_ID`
   - Database: `notion.so/<workspace>/`**`4d5e6f...`**`?v=...` (the 32 characters before `?v=`) → `NOTION_INCIDENTS_DB_ID`, `NOTION_DASHBOARD_DB_ID`
3. `bot/.env`: `NOTION_RULES_PAGE_ID`, `NOTION_INCIDENTS_DB_ID`, `NOTION_DASHBOARD_DB_ID`. `web/.env.local` (and Vercel): `NOTION_RULES_PAGE_ID`.

**Verify:** restart the worker. It logs `[notion] Safety Rules page reachable: "..."` and **no** `[notion] WARN ... is missing property` lines (fix any property it names). Within a minute the **Tonight** database gets one row per session. In the app, `/safety` shows the contacts under "From your society's Safety Rules in Notion" (not "Offline copy"), and `/dashboard` → **Safety rules** links to the page. An SOS from the app creates an **Incidents** page within a few seconds.

---

## D. Discord bot

1. https://discord.com/developers/applications → **New Application** → name `Flock` → Create. Copy the **Application ID** (General Information).
2. **Bot** → **Reset Token** → copy → `DISCORD_BOT_TOKEN` in `bot/.env`. No privileged intents are needed.
3. Invite it to the society server with this URL (replace `<APPLICATION_ID>`; permissions `311385132032` = View Channels, Send Messages, Create Public Threads, Send Messages in Threads, Use Application Commands):

   ```
   https://discord.com/oauth2/authorize?client_id=<APPLICATION_ID>&scope=bot%20applications.commands&permissions=311385132032
   ```

4. Create two normal **text** channels, e.g. `#study-sessions` and `#safety-alerts`.
5. Discord → **User Settings → Advanced → Developer Mode** on. Right-click the server icon → **Copy Server ID** → `DISCORD_GUILD_ID`. Right-click each channel → **Copy Channel ID** → `DISCORD_SESSIONS_CHANNEL_ID`, `DISCORD_ALERT_CHANNEL_ID`.

**Verify:** restart the worker; no `[discord] DISABLED` lines. Any session ending in the next 24 h gets a thread `<title> · ends HH:MM` in the sessions channel. Typing `/flock` in the server replies with the sessions link (needs `WEB_URL`, step F).

---

## E. Zero webhook

1. Grok Bot runs **G5**: a follow-up sequence for new Flock members and a "London student societies" pipeline. In Zero, create an inbound **webhook** trigger for the follow-up sequence and copy its URL. (If the menu names differ in your Zero workspace, ask Grok Bot for the click path.)
2. `ZERO_WEBHOOK_URL=<url>` in `web/.env.local` and in Vercel.

After onboarding, `web/src/app/api/zero/route.ts` sends exactly this JSON (first name, community, university domain and join time; never the email):

```json
{
  "event": "member.joined",
  "first_name": "Amara",
  "community": "The Hack Collective",
  "uni_domain": "ucl.ac.uk",
  "joined_at": "2026-10-22T20:41:00.000Z"
}
```

**Verify:** send a synthetic test event and check it appears in Zero:

```bash
curl -s -X POST "$ZERO_WEBHOOK_URL" -H 'content-type: application/json' \
  -d '{"event":"member.joined","first_name":"Test","community":"The Hack Collective","uni_domain":"demo.flock.test","joined_at":"2026-10-22T21:00:00Z"}'
```

Then sign up a new account in the app. If forwarding fails, the server log (terminal or Vercel → Logs) shows `[api/zero] ...` with the reason; onboarding is never blocked.

---

## F. Vercel

1. https://vercel.com/new → **Import** `wonseok522/flock`.
2. **Root Directory** → Edit → `web`. Framework preset: Next.js (auto).
3. **Environment Variables**: the `web/.env.local` values: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NOTION_TOKEN`, `NOTION_RULES_PAGE_ID`, `ZERO_WEBHOOK_URL`, and optionally `GITHUB_TOKEN`, `GROUP_CHAT_BASELINE_SECONDS`. **Never** add a `NEXT_PUBLIC_` prefix to the service role key. The Luma vars are only for scripts.
4. **Deploy**. Copy the production URL.
5. Then:
   - `bot/.env` → `WEB_URL=https://<your-vercel-url>` (no trailing slash) → restart the worker.
   - Supabase → Authentication → URL Configuration → **Site URL** = the Vercel URL, and add `https://<your-vercel-url>/**` to **Redirect URLs** (step A4).

**Verify:** open the Vercel URL on a phone on mobile data, sign in with a code, and reach Tonight. Discord links (thread intro, reminders, `/flock`) point to the Vercel URL.

---

## G. Demo settings

The missed check-in alert fires `checkin_window_min` minutes after both people's leave time (default 45). For the demo, make it 1 minute. Supabase → **SQL Editor**:

```sql
update settings set value = '1' where key = 'checkin_window_min';   -- demo
```

**Put it back right after the demo**:

```sql
update settings set value = '45' where key = 'checkin_window_min';  -- real use
```

Other demo prep:

- `npm run seed:demo -- --reset` about 5 minutes before the demo, so the seeded walkers' leave times are within 20 minutes of now and show up as "Also heading your way".
- `GROUP_CHAT_BASELINE_SECONDS` in Vercel: the group-chat reply time you measured at the live test (default 600 s). `/dashboard` shows "Nx faster with Flock" from it.

**Verify:** match two phones with leave time **Now** and don't tap "I'm home". About a minute later the worker logs `[missed-walks] missed check-in: ...`, Discord posts "Check-in missed: ...", and a `Missed check-in` page appears in Notion **Incidents** and on `/dashboard`.

---

## Run order on the demo laptop

```bash
# terminal 1: Cognee
cd ai-service && .venv/bin/uvicorn main:app --port 8001
# terminal 2: worker
cd bot && npm start
# terminal 3 (only if not using Vercel): web
cd web && npm run dev
```

If Cognee, Notion or Discord is missing, the worker logs one `DISABLED` line and the app shows a labelled fallback (for example "Cognee reason unavailable"). Any fallback used in the demo must be said out loud.
