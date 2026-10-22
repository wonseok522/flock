# Notion schema the Flock worker expects

Grok Bot (task G2) creates **Flock Safety HQ** in Notion. The worker (`bot/`) reads and writes the two databases below, so the **property names and types must match exactly** (names are case-sensitive). On startup the worker checks both databases and logs any missing or mistyped property, for example:

```
[notion] WARN incidents DB is missing property "Kind" (select). See bot/notion-schema.md
```

Share the Safety Rules page and both databases with the Flock Notion integration (`...` menu → Connections), then put the IDs in `bot/.env`. A database ID or a data source ID both work.

## 1. Incidents database (`NOTION_INCIDENTS_DB_ID`)

| Property | Type | Written by | Values |
|---|---|---|---|
| `Title` | Title | worker | `Missed check-in · Amara & Ben · Late study` (kind · first names · session) |
| `Kind` | Select | worker | `missed_checkin`, `help`, `report` |
| `Members` | Text | worker | First names only, comma-separated: `Amara, Ben` |
| `Session` | Text | worker | Session title: `Late study` |
| `Status` | Select (or Status) | worker sets `open`, then `resolved` when it's resolved in Flock | `open`, `resolved` |
| `Created` | Date | worker | When the incident was created (with time) |
| `Grok recommendation` | Text | **Grok Bot** (G9) | `confirm` / `reject` / `follow up` + one line that cites a Safety Rule |

- Create the select options exactly as lowercase `open` and `resolved`. If `Status` is Notion's built-in **Status** type, both options must exist already. The worker can't create Status options, but it can create Select options.
- Every 30 s the worker copies a non-empty `Grok recommendation` from **open** incidents into Supabase (`incidents.grok_recommendation`). It appears on the Flock `/dashboard`, where a human confirms or rejects. Grok Bot never bans anyone.
- Page body (written by the worker): what happened, the time (London), the Flock incident id and a note asking Grok Bot to review it against the Safety Rules. For SOS incidents it also includes the OpenStreetMap link to the location the member shared. For reports it includes the reporter's evidence. The worker appends a line when an incident is escalated or resolved.
- If the title property has a different name (Notion's default is `Name`), the worker still uses it but logs a warning. Rename it to `Title`.

## 2. Tonight dashboard database (`NOTION_DASHBOARD_DB_ID`)

One row per session that ends between 6 h ago and 12 h from now, updated every 60 s (only when a number changes).

| Property | Type | Values |
|---|---|---|
| `Session` | Title | `<session title> · <ends HH:MM>`, e.g. `Late study · 23:30`. This is the row key: don't rename rows |
| `Walkers` | Number | Number of different people who asked for a walk buddy |
| `Matches` | Number | Walk matches made |
| `Avg seconds to match` | Number | Average `seconds_to_match` (empty if no matches). This is the 10x metric |
| `Missed check-ins` | Number | `missed_checkin` incidents for the session |

## 3. Safety Rules page (`NOTION_RULES_PAGE_ID`)

A normal page. Grok Bot reads it to make recommendations. The worker only checks on startup that it can reach it (`[notion] Safety Rules page reachable: "..."`).
