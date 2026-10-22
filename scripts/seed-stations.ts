// Seed `stations` from OpenStreetMap (Overpass): rail, Tube, DLR, Overground
// and Elizabeth line stations inside Greater London. Stations are the only
// destinations Flock ever stores (never home addresses).
//
//   npm run seed:stations                         → upsert into Supabase (service role)
//   npm run seed:stations -- --sql .cache/stations.sql   → write idempotent SQL instead
import {
  cachedFetchText, distanceM, ewktPoint, fail, parseArgs, serviceClient, sqlStr, writeSql,
} from './lib.ts';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
// overpass-api.de answers 406 to generic browser User-Agents from scripts, so
// Overpass gets an identifying UA (its usage policy asks for one).
const OVERPASS_UA = 'Flock/1.0 (student safety hackathon; +https://github.com/SadDONUT1/flock) node-fetch';

const QUERY = `
[out:json][timeout:90];
area["name"="Greater London"]["boundary"="administrative"]->.london;
(
  node["railway"="station"](area.london);
  node["public_transport"="station"]["station"~"^(subway|light_rail)$"](area.london);
);
out body;
`.trim();

const MUST_INCLUDE: Array<{ label: string; names: string[] }> = [
  { label: 'Camden Town', names: ['camden town'] },
  { label: 'Mornington Crescent', names: ['mornington crescent'] },
  { label: 'Hammersmith', names: ['hammersmith'] },
  { label: "King's Cross", names: ["king's cross st. pancras", "king's cross st pancras", "london king's cross", "king's cross"] },
];

interface OverpassNode {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}

interface Station {
  id: number;
  name: string;
  lat: number;
  lng: number;
}

async function fetchOverpass(): Promise<OverpassNode[]> {
  let lastErr: unknown;
  // Public Overpass servers are often at capacity: try every mirror, then back off and retry.
  const backoffSeconds = [0, 15, 45];
  for (const [round, waitS] of backoffSeconds.entries()) {
    if (waitS) {
      console.log(`  … all mirrors busy, retrying in ${waitS}s (round ${round + 1}/${backoffSeconds.length})`);
      await new Promise((r) => setTimeout(r, waitS * 1000));
    }
    for (const endpoint of ENDPOINTS) {
      try {
        const host = new URL(endpoint).host;
        const { text, fromCache } = await cachedFetchText(endpoint, {
          cacheKey: 'overpass-london-stations.json', // shared across mirrors: same query, same data
          ttlMs: 7 * 24 * 3600_000,
          timeoutMs: 120_000,
          method: 'POST',
          body: new URLSearchParams({ data: QUERY }).toString(),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': OVERPASS_UA },
        });
        const json = JSON.parse(text) as { elements?: OverpassNode[]; remark?: string };
        if (!json.elements?.length) throw new Error(`no elements (${json.remark ?? 'empty response'})`);
        console.log(`  Overpass: ${json.elements.length} raw nodes${fromCache ? ' (from .cache/)' : ` from ${host}`}`);
        return json.elements;
      } catch (err) {
        lastErr = err;
        console.warn(`  ⚠ ${endpoint} failed: ${(err instanceof Error ? err.message : String(err)).split('\n')[0]}`);
      }
    }
  }
  throw new Error(`All Overpass endpoints failed: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

function isRealStation(tags: Record<string, string>): boolean {
  if (!tags.name) return false;
  if (tags.station === 'miniature' || tags['railway:miniature'] || tags.usage === 'tourism') return false;
  if (tags.disused === 'yes' || tags.abandoned === 'yes') return false;
  return true;
}

const norm = (s: string) => s.toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim();

function dedupe(nodes: OverpassNode[]): Station[] {
  const kept: Station[] = [];
  const byName = new Map<string, Station[]>();
  // Stable order: lowest OSM id wins within a name cluster.
  for (const n of [...nodes].sort((a, b) => a.id - b.id)) {
    const tags = n.tags ?? {};
    if (!isRealStation(tags)) continue;
    const s: Station = { id: n.id, name: tags.name!.trim(), lat: n.lat, lng: n.lon };
    const key = norm(s.name);
    const same = byName.get(key) ?? [];
    if (same.some((o) => distanceM(o, s) <= 150)) continue;
    same.push(s);
    byName.set(key, same);
    kept.push(s);
  }
  return kept.sort((a, b) => a.name.localeCompare(b.name));
}

// "Hammersmith (District and Piccadilly lines)" counts as Hammersmith.
const nameMatches = (stationName: string, want: string) => {
  const n = norm(stationName);
  return n === want || n.startsWith(`${want} (`);
};

function verify(stations: Station[]): void {
  let missing = 0;
  for (const want of MUST_INCLUDE) {
    const matches = stations.filter((s) => want.names.some((n) => nameMatches(s.name, n)));
    if (!matches.length) {
      missing++;
      console.warn(`  ✖ missing: ${want.label}`);
    } else {
      console.log(`  ✔ ${want.label}: ${matches.map((m) => `"${m.name}" #${m.id}`).join(', ')}`);
    }
  }
  if (missing) fail('Demo stations missing — check the Overpass query.');
}

async function main(): Promise<void> {
  const { sqlOut } = parseArgs();
  console.log('Seeding stations from OSM Overpass (Greater London)…');
  const stations = dedupe(await fetchOverpass());
  console.log(`  ${stations.length} stations after filtering + name dedupe (≤150 m)`);
  verify(stations);

  if (sqlOut) {
    const rows = stations.map(
      (s) => `  (${s.id}, ${sqlStr(s.name)}, '${ewktPoint(s.lat, s.lng)}'::extensions.geography)`,
    );
    const statements: string[] = [];
    for (let i = 0; i < rows.length; i += 500) {
      statements.push(
        'insert into public.stations (id, name, location) values\n' +
          rows.slice(i, i + 500).join(',\n') +
          '\non conflict (id) do update set name = excluded.name, location = excluded.location;',
      );
    }
    await writeSql(sqlOut, `Flock stations: ${stations.length} Greater London stations from OSM Overpass`, statements);
    return;
  }

  const supabase = serviceClient();
  for (let i = 0; i < stations.length; i += 500) {
    const batch = stations.slice(i, i + 500).map((s) => ({ id: s.id, name: s.name, location: ewktPoint(s.lat, s.lng) }));
    const { error } = await supabase.from('stations').upsert(batch, { onConflict: 'id' });
    if (error) fail(`Upsert failed: ${error.message}`);
  }
  const { count, error } = await supabase.from('stations').select('id', { count: 'exact', head: true });
  if (error) fail(`Count failed: ${error.message}`);
  console.log(`\n✔ Upserted ${stations.length} stations. stations table now has ${count} rows.`);
}

main().catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
