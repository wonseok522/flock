# Flock data scripts

Run from the repo root after `npm install`. Scripts read `web/.env.local` and write to Supabase with `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. Add `--sql <out.sql>` to any script to write an idempotent SQL file instead (`insert … on conflict`). You can then apply it through the Supabase MCP or the SQL editor. This mode needs no Supabase keys. Network responses are cached in `.cache/`, which is gitignored. Apply `supabase/schema.sql` and `supabase/seed.sql` first.

**`seed-stations.ts`** fetches every rail, Tube, DLR, Overground and Elizabeth line station inside the Greater London boundary from OSM Overpass. It tries overpass-api.de, then the kumi.systems and private.coffee mirrors, with backoff between rounds. It drops miniature and heritage stations and merges nodes that share a name within 150 m, keeping the one with the lowest OSM id. Each station is upserted into `stations` with its OSM node id. The script checks that Camden Town, Mornington Crescent, Hammersmith and King's Cross are present. Stations are the only destinations Flock stores; it never stores home addresses.

**`import-luma.ts`** turns Luma events into `study_sessions` with `source = 'luma'` under The Hack Collective, upserting by `luma_event_id`. If `HACK_COLLECTIVE_LUMA_CAL_ID` is set, it downloads the calendar `.ics` and parses it with its own parser, which handles line folding, TZID/UTC times, GEO, and `evt-` ids found in the URL or UID. It imports only future events that end at or after 21:00 London time. If `LUMA_TONIGHT_EVENT_ID` is set, it also imports that event from the event JSON, reading the name, the end time and `coordinate` or `geo_latitude/longitude`. When the venue is hidden, it falls back to Expedite London HQ (51.4951, -0.2282) and labels the location as a fallback. Luma calls are at least 15 s apart and cached for 10 minutes.

**`seed-demo.ts`** creates 8 **synthetic** personas: Amara, Ben, Chloe, Dev, Ella, Femi, Grace and Hugo, all `@demo.flock.test`. It adds them as confirmed auth users and `members` with a sha256 handle hash, trust score 40 and 0 to 5 safe walks, and makes them members of The Hack Collective with Grace as lead. They join the upcoming Hack Collective session that ends soonest. The script never creates a session, so run `import:luma` first. Chloe (Camden Town), Dev (Mornington Crescent) and Hugo (Hammersmith) get open walk requests that leave 5 to 15 minutes from now. Femi goes on the shared blocklist as a confirmed report. `--reset` first deletes the demo users' walk requests, matches, check-ins and solo trips, so the demo can be run again. A real user who was matched with a demo persona has their request cancelled. In `--sql` mode, users go into `auth.users` with `md5(email)::uuid` ids.

```bash
npm install
npm run seed:stations                    # or: npm run seed:stations -- --sql .cache/stations.sql
npm run import:luma                      # or: npm run import:luma -- --sql .cache/luma.sql
npm run seed:demo                        # or: npm run seed:demo -- --sql .cache/demo.sql
npm run seed:demo -- --reset             # re-run the demo from a clean state
npm run typecheck:scripts                # tsc -p scripts
```
