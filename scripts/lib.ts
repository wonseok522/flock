// Shared helpers for Flock data scripts: args, env, cached fetch, SQL output.
// Never prints secret values.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CACHE_DIR = join(REPO_ROOT, '.cache');

export const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

export const HACK_COLLECTIVE = 'The Hack Collective';
export const FALLBACK_VENUE = { lat: 51.4951, lng: -0.2282, name: 'Expedite London HQ (fallback location)' };

// ───────────── CLI args ─────────────
export interface Args {
  sqlOut: string | null;
  flags: Set<string>;
}

export function parseArgs(argv: string[] = process.argv.slice(2)): Args {
  let sqlOut: string | null = null;
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--sql') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) fail('--sql needs an output path, e.g. --sql .cache/out.sql');
      sqlOut = resolve(process.cwd(), next);
      i++;
    } else if (a.startsWith('--sql=')) {
      sqlOut = resolve(process.cwd(), a.slice('--sql='.length));
    } else if (a.startsWith('--')) {
      flags.add(a.slice(2));
    } else {
      fail(`Unknown argument: ${a}`);
    }
  }
  return { sqlOut, flags };
}

export function fail(msg: string): never {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

export function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

// ───────────── Supabase (service role, scripts only) ─────────────
export function serviceClient(): SupabaseClient {
  const url = env('NEXT_PUBLIC_SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const missing = [!url && 'NEXT_PUBLIC_SUPABASE_URL', !key && 'SUPABASE_SERVICE_ROLE_KEY'].filter(Boolean);
  if (missing.length) {
    fail(
      `Missing ${missing.join(' and ')} in web/.env.local.\n` +
        '  Either fill them in (Supabase → Project Settings → API), or run with\n' +
        '  --sql <out.sql> to write an idempotent SQL file and apply it via the Supabase MCP / SQL editor.',
    );
  }
  return createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } });
}

// ───────────── Network: timeout + file cache + per-host throttle ─────────────
const lastCallByHost = new Map<string, number>();

export interface CachedFetchOptions {
  cacheKey: string;          // file name inside .cache/
  ttlMs: number;             // how long a cached response is valid
  timeoutMs?: number;        // per request
  method?: 'GET' | 'POST';
  body?: string;
  headers?: Record<string, string>;
  minIntervalMs?: number;    // throttle per host (e.g. Luma: a few calls per minute)
}

export async function cachedFetchText(url: string, opts: CachedFetchOptions): Promise<{ text: string; fromCache: boolean }> {
  const file = join(CACHE_DIR, opts.cacheKey);
  try {
    const raw = JSON.parse(await readFile(file, 'utf8')) as { fetchedAt: number; text: string };
    if (Date.now() - raw.fetchedAt < opts.ttlMs) return { text: raw.text, fromCache: true };
  } catch {
    /* no cache yet */
  }

  const host = new URL(url).host;
  if (opts.minIntervalMs) {
    const wait = (lastCallByHost.get(host) ?? 0) + opts.minIntervalMs - Date.now();
    if (wait > 0) {
      console.log(`  … waiting ${Math.ceil(wait / 1000)}s (rate limit for ${host})`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  lastCallByHost.set(host, Date.now());

  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    body: opts.body,
    headers: { 'User-Agent': BROWSER_UA, Accept: '*/*', ...opts.headers },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${host} responded ${res.status}: ${text.slice(0, 200)}`);

  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(file, JSON.stringify({ fetchedAt: Date.now(), url, text }));
  return { text, fromCache: false };
}

// ───────────── Hashing / geo ─────────────
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value.toLowerCase()).digest('hex');
}

export function ewktPoint(lat: number, lng: number): string {
  return `SRID=4326;POINT(${lng} ${lat})`;
}

export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ───────────── SQL output ─────────────
export function sqlStr(v: string | null | undefined): string {
  return v == null ? 'null' : `'${v.replace(/'/g, "''")}'`;
}

export function sqlGeog(lat: number, lng: number): string {
  return `extensions.st_setsrid(extensions.st_makepoint(${lng}, ${lat}), 4326)::extensions.geography`;
}

export function sqlTs(d: Date | null | undefined): string {
  return d ? `'${d.toISOString()}'::timestamptz` : 'null';
}

export async function writeSql(path: string, header: string, statements: string[]): Promise<void> {
  const body = [
    `-- ${header}`,
    `-- Generated ${new Date().toISOString()} by scripts/. Idempotent: safe to run more than once.`,
    'begin;',
    ...statements,
    'commit;',
    '',
  ].join('\n\n');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body);
  console.log(`\n✔ Wrote ${statements.length} statement(s) to ${path}`);
}

// ───────────── Time ─────────────
export function londonParts(d: Date): { hour: number; minute: number; ymd: string } {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { hour: Number(p.hour), minute: Number(p.minute), ymd: `${p.year}-${p.month}-${p.day}` };
}

export function londonTime(d: Date): string {
  return d.toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' });
}
