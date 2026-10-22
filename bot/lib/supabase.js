// Supabase with the SERVICE ROLE key. This process runs only on the demo
// laptop; the key never leaves bot/.env.
import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

let client;

export function supabase() {
  if (!client) {
    try {
      client = createClient(config.supabaseUrl, config.supabaseKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
    } catch (e) {
      console.error(`[config] SUPABASE_URL is not valid (${e.message}). Nothing was started.`);
      process.exit(1);
    }
  }
  return client;
}

/** Unwrap a supabase-js result or throw a labelled error. */
export function must(result, what) {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data ?? [];
}

const uniq = (xs) => [...new Set(xs.filter(Boolean))];

/** Map<id, row> for the given ids. `cols` must include `id`. */
export async function byIds(table, ids, cols) {
  const list = uniq(ids);
  if (!list.length) return new Map();
  const rows = must(await supabase().from(table).select(cols).in('id', list), `select ${table}`);
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * For each match: both participants (member id, first name, station name) and
 * the session. Manual lookups instead of PostgREST embeds, because matches has
 * two FKs to walk_requests and several paths to study_sessions.
 */
export async function loadMatchContext(matches) {
  const requests = await byIds(
    'walk_requests',
    matches.flatMap((m) => [m.request_a, m.request_b]),
    'id, member_id, station_id, leave_at',
  );
  const reqs = [...requests.values()];
  const [members, stations, sessions] = await Promise.all([
    byIds('members', reqs.map((r) => r.member_id), 'id, first_name'),
    byIds('stations', reqs.map((r) => r.station_id), 'id, name'),
    byIds('study_sessions', matches.map((m) => m.session_id), 'id, title, community_id, discord_thread_id'),
  ]);
  const person = (requestId) => {
    const r = requests.get(requestId);
    if (!r) return null;
    return {
      memberId: r.member_id,
      firstName: members.get(r.member_id)?.first_name ?? 'A Flock member',
      station: stations.get(r.station_id)?.name ?? null,
    };
  };
  return new Map(matches.map((m) => [m.id, {
    a: person(m.request_a),
    b: person(m.request_b),
    session: sessions.get(m.session_id) ?? null,
  }]));
}

/** First community of a member (fallback when a solo trip has no session). */
export async function memberCommunity(memberId) {
  const rows = must(
    await supabase().from('community_members').select('community_id').eq('member_id', memberId).limit(1),
    'select community_members',
  );
  return rows[0]?.community_id ?? null;
}
