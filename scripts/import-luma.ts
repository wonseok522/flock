// Import late-night events from The Hack Collective's Luma calendar (.ics) and
// tonight's event (Luma event JSON) as `study_sessions` (source = 'luma').
//
//   npm run import:luma                          → upsert into Supabase (service role)
//   npm run import:luma -- --sql .cache/luma.sql → write idempotent SQL instead
//
// Env: HACK_COLLECTIVE_LUMA_CAL_ID (optional), LUMA_TONIGHT_EVENT_ID (optional).
// Luma's API is undocumented: responses are cached and calls are spaced ≥15 s apart.
import {
  FALLBACK_VENUE, HACK_COLLECTIVE, cachedFetchText, distanceM, env, ewktPoint, fail, londonParts,
  londonTime, parseArgs, serviceClient, sqlGeog, sqlStr, sqlTs, writeSql,
} from './lib.ts';

const LUMA_MIN_INTERVAL_MS = 15_000; // ≤4 calls per minute
const LUMA_TTL_MS = 10 * 60_000;

export interface LumaSession {
  luma_event_id: string;
  title: string;
  location_name: string | null;
  lat: number | null;
  lng: number | null;
  starts_at: Date | null;
  ends_at: Date;
  note: string;
}

// ───────────── ICS parsing (RFC 5545 subset, no deps) ─────────────
interface IcsProp {
  name: string;
  params: Record<string, string>;
  value: string;
}

function unfold(ics: string): string[] {
  // Lines starting with a space or tab continue the previous line.
  return ics.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function parseProp(line: string): IcsProp | null {
  // NAME;PARAM=a;PARAM2="b:c":value — the first ':' outside quotes splits.
  let inQuotes = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ':' && !inQuotes) { colon = i; break; }
  }
  if (colon < 0) return null;
  const [name, ...paramParts] = line.slice(0, colon).split(';');
  const params: Record<string, string> = {};
  for (const p of paramParts) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name!.toUpperCase(), params, value: line.slice(colon + 1) };
}

function unescapeText(v: string): string {
  return v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();
}

// Offset (ms) of a time zone at a UTC instant, via Intl.
function tzOffsetMs(utcMs: number, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return asUtc - utcMs;
}

export function parseIcsDate(prop: IcsProp): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(prop.value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (h === undefined) return null; // all-day events are not late-night sessions
  const wall = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  if (z) return new Date(wall);
  const tz = prop.params.TZID ?? 'Europe/London'; // floating time → assume London
  try {
    let utc = wall - tzOffsetMs(wall, tz);
    utc = wall - tzOffsetMs(utc, tz); // second pass handles DST edges
    return new Date(utc);
  } catch {
    return null; // unknown TZID
  }
}

export function parseIcs(ics: string): LumaSession[] {
  const out: LumaSession[] = [];
  let cur: IcsProp[] | null = null;
  for (const line of unfold(ics)) {
    if (line === 'BEGIN:VEVENT') { cur = []; continue; }
    if (line === 'END:VEVENT') {
      if (cur) {
        const get = (n: string) => cur!.find((p) => p.name === n);
        const idSource = [get('URL')?.value, get('UID')?.value, get('DESCRIPTION')?.value].join(' ');
        const evt = /evt-[A-Za-z0-9]+/.exec(idSource)?.[0];
        const start = get('DTSTART');
        const end = get('DTEND');
        const startsAt = start ? parseIcsDate(start) : null;
        const endsAt = end ? parseIcsDate(end) : null;
        const geo = get('GEO')?.value.split(/[;,]/).map(Number);
        const hasGeo = geo?.length === 2 && geo.every((n) => Number.isFinite(n));
        const loc = get('LOCATION') ? unescapeText(get('LOCATION')!.value) : null;
        if (evt && endsAt) {
          out.push({
            luma_event_id: evt,
            title: unescapeText(get('SUMMARY')?.value ?? 'Luma event'),
            location_name: loc && !/^https?:\/\//.test(loc) ? loc.slice(0, 200) : null,
            lat: hasGeo ? geo![0]! : null,
            lng: hasGeo ? geo![1]! : null,
            starts_at: startsAt,
            ends_at: endsAt,
            note: hasGeo ? 'ics' : 'ics (no GEO: no map pin)',
          });
        }
      }
      cur = null;
      continue;
    }
    if (cur) {
      const p = parseProp(line);
      if (p) cur.push(p);
    }
  }
  return out;
}

// "Late" = ends at or after 21:00 London time (or in the small hours).
export function isLate(endsAt: Date): boolean {
  const { hour } = londonParts(endsAt);
  return hour >= 21 || hour < 5;
}

// ───────────── Luma fetches ─────────────
async function fetchCalendar(calId: string): Promise<LumaSession[]> {
  const url = `https://api.lu.ma/ics/get?entity=calendar&id=${encodeURIComponent(calId)}`;
  const { text, fromCache } = await cachedFetchText(url, {
    cacheKey: `luma-cal-${calId}.json`, ttlMs: LUMA_TTL_MS, minIntervalMs: LUMA_MIN_INTERVAL_MS,
    headers: { Accept: 'text/calendar,*/*' },
  });
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error(`Luma calendar did not return ICS: ${text.slice(0, 120)}`);
  const all = parseIcs(text);
  const now = Date.now();
  const kept = all.filter((e) => e.ends_at.getTime() > now && isLate(e.ends_at));
  console.log(`  Calendar: ${all.length} events${fromCache ? ' (cached)' : ''}, ${kept.length} upcoming + ending ≥21:00 London`);
  return kept;
}

interface LumaEventJson {
  event?: {
    api_id?: string;
    name?: string;
    start_at?: string;
    end_at?: string;
    geo_latitude?: number | string | null;
    geo_longitude?: number | string | null;
    coordinate?: { latitude?: number; longitude?: number } | null;
    geo_address_info?: { mode?: string; address?: string; full_address?: string; city?: string } | null;
  };
}

async function fetchTonight(eventId: string): Promise<LumaSession> {
  const url = `https://api.lu.ma/event/get?event_api_id=${encodeURIComponent(eventId)}`;
  const { text, fromCache } = await cachedFetchText(url, {
    cacheKey: `luma-event-${eventId}.json`, ttlMs: LUMA_TTL_MS, minIntervalMs: LUMA_MIN_INTERVAL_MS,
    headers: { Accept: 'application/json' },
  });
  const e = (JSON.parse(text) as LumaEventJson).event;
  if (!e?.name || !e.end_at) throw new Error(`Unexpected Luma event JSON for ${eventId}`);

  const num = (v: unknown) => (v === null || v === undefined || v === '' ? NaN : Number(v));
  let lat = num(e.geo_latitude);
  let lng = num(e.geo_longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    lat = num(e.coordinate?.latitude);
    lng = num(e.coordinate?.longitude);
  }
  const hasGeo = Number.isFinite(lat) && Number.isFinite(lng);
  const address = e.geo_address_info?.full_address ?? e.geo_address_info?.address ?? null;

  let location_name: string;
  let note: string;
  if (!hasGeo) {
    lat = FALLBACK_VENUE.lat;
    lng = FALLBACK_VENUE.lng;
    location_name = FALLBACK_VENUE.name;
    note = 'venue hidden on Luma → fallback location';
  } else if (address) {
    location_name = address;
    note = 'Luma venue';
  } else if (distanceM({ lat, lng }, FALLBACK_VENUE) < 300) {
    location_name = 'Expedite London HQ';
    note = `Luma coordinate (address ${e.geo_address_info?.mode ?? 'hidden'}), matches the known venue`;
  } else {
    location_name = `${e.geo_address_info?.city ?? 'London'} (exact address hidden on Luma)`;
    note = `Luma coordinate (address ${e.geo_address_info?.mode ?? 'hidden'})`;
  }

  console.log(`  Tonight: "${e.name}"${fromCache ? ' (cached)' : ''} ends ${londonTime(new Date(e.end_at))} London, ` +
    `geo ${hasGeo ? `present (${lat.toFixed(5)}, ${lng.toFixed(5)})` : 'missing'}`);
  return {
    luma_event_id: e.api_id ?? eventId,
    title: e.name,
    location_name,
    lat, lng,
    starts_at: e.start_at ? new Date(e.start_at) : null,
    ends_at: new Date(e.end_at),
    note,
  };
}

// ───────────── Main ─────────────
async function main(): Promise<void> {
  const { sqlOut } = parseArgs();
  const calId = env('HACK_COLLECTIVE_LUMA_CAL_ID');
  const tonightId = env('LUMA_TONIGHT_EVENT_ID');
  if (!calId && !tonightId) fail('Set HACK_COLLECTIVE_LUMA_CAL_ID and/or LUMA_TONIGHT_EVENT_ID in web/.env.local.');

  console.log(`Importing Luma events into study_sessions (community: ${HACK_COLLECTIVE})…`);
  const sessions = new Map<string, LumaSession>();
  if (calId) {
    try {
      for (const s of await fetchCalendar(calId)) sessions.set(s.luma_event_id, s);
    } catch (err) {
      console.warn(`  ⚠ Calendar import failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    console.log('  HACK_COLLECTIVE_LUMA_CAL_ID not set → skipping calendar, importing tonight\'s event only');
  }
  if (tonightId) {
    const t = await fetchTonight(tonightId);
    if (t.ends_at.getTime() < Date.now()) console.warn('  ⚠ Tonight\'s event has already ended (imported anyway).');
    sessions.set(t.luma_event_id, t);
  }
  if (!sessions.size) fail('Nothing to import.');

  console.log('\n  Sessions:');
  for (const s of sessions.values()) {
    console.log(`   • ${s.luma_event_id}  "${s.title}"  ends ${londonTime(s.ends_at)}  @ ${s.location_name ?? '—'}  [${s.note}]`);
  }

  if (sqlOut) {
    const statements = [...sessions.values()].map((s) =>
      [
        'insert into public.study_sessions (community_id, title, location_name, location, starts_at, ends_at, source, luma_event_id)',
        `select c.id, ${sqlStr(s.title)}, ${sqlStr(s.location_name)}, ` +
          `${s.lat !== null && s.lng !== null ? sqlGeog(s.lat, s.lng) : 'null'}, ` +
          `${sqlTs(s.starts_at)}, ${sqlTs(s.ends_at)}, 'luma', ${sqlStr(s.luma_event_id)}`,
        `from public.communities c where c.name = ${sqlStr(HACK_COLLECTIVE)}`,
        'on conflict (luma_event_id) do update set title = excluded.title, location_name = excluded.location_name,',
        '  location = excluded.location, starts_at = excluded.starts_at, ends_at = excluded.ends_at;',
      ].join('\n'),
    );
    await writeSql(sqlOut, `Flock Luma import: ${sessions.size} session(s) for ${HACK_COLLECTIVE}`, statements);
    return;
  }

  const supabase = serviceClient();
  const { data: community, error: cErr } = await supabase.from('communities').select('id').eq('name', HACK_COLLECTIVE).maybeSingle();
  if (cErr) fail(`Community lookup failed: ${cErr.message}`);
  if (!community) fail(`Community "${HACK_COLLECTIVE}" not found — apply supabase/seed.sql first.`);

  const rows = [...sessions.values()].map((s) => ({
    community_id: community.id as string,
    title: s.title,
    location_name: s.location_name,
    location: s.lat !== null && s.lng !== null ? ewktPoint(s.lat, s.lng) : null,
    starts_at: s.starts_at?.toISOString() ?? null,
    ends_at: s.ends_at.toISOString(),
    source: 'luma',
    luma_event_id: s.luma_event_id,
  }));
  const { data, error } = await supabase.from('study_sessions').upsert(rows, { onConflict: 'luma_event_id' }).select('id, luma_event_id');
  if (error) fail(`Upsert failed: ${error.message}`);
  console.log(`\n✔ Upserted ${data?.length ?? 0} Luma session(s) into study_sessions.`);
}

// Only run when executed directly (parseIcs etc. are importable for tests).
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  main().catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
}
