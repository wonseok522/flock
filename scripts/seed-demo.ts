// Synthetic demo users for Flock: 8 personas at @demo.flock.test (no real people).
// Creates auth users + members, adds them to The Hack Collective (Grace = lead),
// joins them to the soonest-ending upcoming Hack Collective session, opens walk
// requests for Chloe, Dev and Hugo, and puts Femi on the shared blocklist.
// This script never creates sessions; run import-luma first.
//
//   npm run seed:demo                          → write to Supabase (service role)
//   npm run seed:demo -- --reset               → clear demo walks/matches/check-ins, then re-seed
//   npm run seed:demo -- --sql .cache/demo.sql [--reset] → write idempotent SQL instead
import type { SupabaseClient } from '@supabase/supabase-js';
import { HACK_COLLECTIVE, fail, parseArgs, serviceClient, sha256Hex, sqlStr, writeSql } from './lib.ts';

const DOMAIN = 'demo.flock.test';
const TRUST_REASONS = ['Verified demo student (synthetic)'];
const BLOCK_REASON = 'Demo: confirmed report (synthetic)';

interface Persona {
  first: string;
  station: string;           // destination station (OSM name)
  leaveInMin: number;
  safeWalks: number;
  walkRequest?: boolean;     // open a walk request now
  lead?: boolean;
  blocked?: boolean;
}

const PERSONAS: Persona[] = [
  { first: 'Amara', station: 'Camden Town', leaveInMin: 8, safeWalks: 3 },
  { first: 'Ben', station: 'Mornington Crescent', leaveInMin: 12, safeWalks: 1 },
  { first: 'Chloe', station: 'Camden Town', leaveInMin: 5, safeWalks: 2, walkRequest: true },
  { first: 'Dev', station: 'Mornington Crescent', leaveInMin: 10, safeWalks: 4, walkRequest: true },
  { first: 'Ella', station: "King's Cross St Pancras", leaveInMin: 15, safeWalks: 0 },
  { first: 'Femi', station: "King's Cross St Pancras", leaveInMin: 6, safeWalks: 0, blocked: true },
  { first: 'Grace', station: 'Camden Town', leaveInMin: 20, safeWalks: 5, lead: true },
  { first: 'Hugo', station: 'Hammersmith (District and Piccadilly lines)', leaveInMin: 15, safeWalks: 1, walkRequest: true },
];

const emailOf = (p: Persona) => `${p.first.toLowerCase()}@${DOMAIN}`;
const EMAILS = PERSONAS.map(emailOf);

// ───────────── SQL mode ─────────────
const SQL_SESSION = `(select s.id from public.study_sessions s join public.communities c on c.id = s.community_id
   where c.name = ${sqlStr(HACK_COLLECTIVE)} and s.ends_at > now() order by s.ends_at limit 1)`;
const sqlEmails = EMAILS.map((e) => sqlStr(e)).join(', ');
const SQL_DEMO_IDS = `(select id from auth.users where email in (${sqlEmails}))`;

function sqlReset(): string[] {
  const demoReqs = `(select id from public.walk_requests where member_id in ${SQL_DEMO_IDS})`;
  const demoMatches = `(select id from public.matches where request_a in ${demoReqs} or request_b in ${demoReqs})`;
  const demoTrips = `(select id from public.solo_trips where member_id in ${SQL_DEMO_IDS})`;
  return [
    '-- reset: clear demo users\' walks, matches, check-ins, solo trips',
    `delete from public.checkins where member_id in ${SQL_DEMO_IDS} or match_id in ${demoMatches} or solo_trip_id in ${demoTrips};`,
    `delete from public.incidents where match_id in ${demoMatches} or solo_trip_id in ${demoTrips};`,
    `update public.reports set match_id = null where match_id in ${demoMatches};`,
    `-- a real user matched with a demo user gets their request closed, not deleted
update public.walk_requests set status = 'cancelled'
where member_id not in ${SQL_DEMO_IDS} and status = 'matched'
  and id in (select request_a from public.matches where id in ${demoMatches}
             union select request_b from public.matches where id in ${demoMatches});`,
    `delete from public.matches where id in ${demoMatches};`,
    `delete from public.solo_trips where member_id in ${SQL_DEMO_IDS};`,
    `delete from public.walk_requests where member_id in ${SQL_DEMO_IDS};`,
  ];
}

function sqlSeed(): string[] {
  const out: string[] = [];
  // auth.users with deterministic ids (md5(email)::uuid). Token columns must be '' not NULL for GoTrue.
  out.push(
    `insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
select '00000000-0000-0000-0000-000000000000', md5(e)::uuid, 'authenticated', 'authenticated', e, now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
from unnest(array[${sqlEmails}]) as e
where not exists (select 1 from auth.users u where u.email = e)
on conflict do nothing;`,
  );
  // members — keyed by email lookup, so it also works for users created via the admin API.
  const memberRows = PERSONAS.map((p) => `(${sqlStr(emailOf(p))}, ${sqlStr(p.first)}, ${p.safeWalks})`).join(',\n  ');
  out.push(
    `insert into public.members (id, first_name, uni_domain, handle_hash, trust_score, trust_reasons, safe_walks, verified_at)
select u.id, v.first_name, ${sqlStr(DOMAIN)}, encode(extensions.digest(lower(v.email), 'sha256'), 'hex'), 40,
  array[${TRUST_REASONS.map((r) => sqlStr(r)).join(', ')}], v.safe_walks, now()
from (values
  ${memberRows}
) as v(email, first_name, safe_walks)
join auth.users u on u.email = v.email
on conflict (id) do nothing;`,
  );
  out.push(
    `insert into public.community_members (community_id, member_id, role)
select c.id, u.id, case when u.email = ${sqlStr(emailOf(PERSONAS.find((p) => p.lead)!))} then 'lead' else 'member' end
from public.communities c, auth.users u
where c.name = ${sqlStr(HACK_COLLECTIVE)} and u.email in (${sqlEmails})
on conflict (community_id, member_id) do update set role = excluded.role;`,
  );
  out.push(
    `-- join the soonest-ending upcoming Hack Collective session (none → nothing joined)
insert into public.session_members (session_id, member_id)
select ${SQL_SESSION}, m.id from public.members m join auth.users u on u.id = m.id
where u.email in (${sqlEmails}) and ${SQL_SESSION} is not null
on conflict (session_id, member_id) do nothing;`,
  );
  for (const p of PERSONAS.filter((x) => x.walkRequest)) {
    out.push(
      `-- open walk request: ${p.first} → ${p.station}, leaving in ${p.leaveInMin} min
insert into public.walk_requests (member_id, session_id, station_id, destination, leave_at, status)
select u.id, ${SQL_SESSION}, st.id, st.location, now() + interval '${p.leaveInMin} minutes', 'open'
from auth.users u
cross join lateral (select id, location from public.stations where name = ${sqlStr(p.station)} order by id limit 1) st
where u.email = ${sqlStr(emailOf(p))} and ${SQL_SESSION} is not null
  and not exists (select 1 from public.walk_requests r where r.member_id = u.id and r.status = 'open');`,
    );
  }
  const blocked = PERSONAS.find((p) => p.blocked)!;
  const lead = PERSONAS.find((p) => p.lead)!;
  out.push(
    `-- ${blocked.first} on the shared blocklist (hash only), confirmed by a human lead (${lead.first})
insert into public.blocklist (handle_hash, reason, confirmed_by_community, confirmed_by_member)
select encode(extensions.digest(lower(${sqlStr(emailOf(blocked))}), 'sha256'), 'hex'), ${sqlStr(BLOCK_REASON)}, c.id,
  (select id from auth.users where email = ${sqlStr(emailOf(lead))})
from public.communities c where c.name = ${sqlStr(HACK_COLLECTIVE)}
on conflict (handle_hash) do nothing;`,
  );
  return out;
}

// ───────────── Live mode (service role) ─────────────
async function must<T>(label: string, p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) fail(`${label}: ${error.message}`);
  return data;
}

async function ensureUsers(supabase: SupabaseClient): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (let page = 1; page < 50; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) fail(`listUsers: ${error.message}`);
    for (const u of data.users) if (u.email && EMAILS.includes(u.email.toLowerCase())) ids.set(u.email.toLowerCase(), u.id);
    if (data.users.length < 1000) break;
  }
  for (const email of EMAILS) {
    if (ids.has(email)) continue;
    const { data, error } = await supabase.auth.admin.createUser({ email, email_confirm: true });
    if (error || !data.user) fail(`createUser ${email}: ${error?.message ?? 'no user returned'}`);
    ids.set(email, data.user.id);
    console.log(`  + auth user ${email}`);
  }
  return ids;
}

async function liveReset(supabase: SupabaseClient, memberIds: string[]): Promise<void> {
  const reqs = await must('reset: walk_requests', supabase.from('walk_requests').select('id').in('member_id', memberIds));
  const reqIds = (reqs ?? []).map((r: { id: string }) => r.id);
  const trips = await must('reset: solo_trips', supabase.from('solo_trips').select('id').in('member_id', memberIds));
  const tripIds = (trips ?? []).map((t: { id: string }) => t.id);
  let matchRows: Array<{ id: string; request_a: string; request_b: string }> = [];
  if (reqIds.length) {
    const list = reqIds.join(',');
    matchRows = (await must('reset: matches', supabase.from('matches').select('id, request_a, request_b')
      .or(`request_a.in.(${list}),request_b.in.(${list})`))) ?? [];
  }
  const matchIds = matchRows.map((m) => m.id);
  await must('reset: checkins', supabase.from('checkins').delete().in('member_id', memberIds));
  if (matchIds.length) {
    await must('reset: checkins (match)', supabase.from('checkins').delete().in('match_id', matchIds));
    await must('reset: incidents (match)', supabase.from('incidents').delete().in('match_id', matchIds));
    await must('reset: reports', supabase.from('reports').update({ match_id: null }).in('match_id', matchIds));
    const otherReqs = matchRows.flatMap((m) => [m.request_a, m.request_b]).filter((id) => !reqIds.includes(id));
    if (otherReqs.length) {
      await must('reset: real users\' requests', supabase.from('walk_requests').update({ status: 'cancelled' })
        .in('id', otherReqs).eq('status', 'matched'));
    }
    await must('reset: matches', supabase.from('matches').delete().in('id', matchIds));
  }
  if (tripIds.length) {
    await must('reset: checkins (solo)', supabase.from('checkins').delete().in('solo_trip_id', tripIds));
    await must('reset: incidents (solo)', supabase.from('incidents').delete().in('solo_trip_id', tripIds));
    await must('reset: solo_trips', supabase.from('solo_trips').delete().in('id', tripIds));
  }
  await must('reset: walk_requests', supabase.from('walk_requests').delete().in('member_id', memberIds));
  console.log(`  ↺ reset: removed ${reqIds.length} walk request(s), ${matchIds.length} match(es), ${tripIds.length} solo trip(s)`);
}

async function live(reset: boolean): Promise<void> {
  const supabase = serviceClient();
  const community = await must('community lookup',
    supabase.from('communities').select('id').eq('name', HACK_COLLECTIVE).maybeSingle());
  if (!community) fail(`Community "${HACK_COLLECTIVE}" not found — apply supabase/seed.sql first.`);
  const communityId = (community as { id: string }).id;

  const ids = await ensureUsers(supabase);
  const idOf = (p: Persona) => ids.get(emailOf(p))!;
  const memberIds = PERSONAS.map(idOf);

  if (reset) await liveReset(supabase, memberIds);

  await must('members', supabase.from('members').upsert(PERSONAS.map((p) => ({
    id: idOf(p), first_name: p.first, uni_domain: DOMAIN, handle_hash: sha256Hex(emailOf(p)),
    trust_score: 40, trust_reasons: TRUST_REASONS, safe_walks: p.safeWalks, verified_at: new Date().toISOString(),
  })), { onConflict: 'id', ignoreDuplicates: true }));

  await must('community_members', supabase.from('community_members').upsert(PERSONAS.map((p) => ({
    community_id: communityId, member_id: idOf(p), role: p.lead ? 'lead' : 'member',
  })), { onConflict: 'community_id,member_id' }));

  const session = await must('session lookup', supabase.from('study_sessions').select('id, title, ends_at')
    .eq('community_id', communityId).gt('ends_at', new Date().toISOString())
    .order('ends_at', { ascending: true }).limit(1).maybeSingle());

  if (!session) {
    console.warn('  ⚠ No upcoming Hack Collective session — run `npm run import:luma` first. Skipping session joins + walk requests.');
  } else {
    const s = session as { id: string; title: string; ends_at: string };
    await must('session_members', supabase.from('session_members').upsert(
      memberIds.map((member_id) => ({ session_id: s.id, member_id })),
      { onConflict: 'session_id,member_id', ignoreDuplicates: true }));
    console.log(`  ✔ ${memberIds.length} personas joined "${s.title}"`);

    for (const p of PERSONAS.filter((x) => x.walkRequest)) {
      const open = await must('open request check', supabase.from('walk_requests').select('id')
        .eq('member_id', idOf(p)).eq('status', 'open').limit(1));
      if (open?.length) { console.log(`  = ${p.first} already has an open walk request`); continue; }
      const st = await must(`station ${p.station}`, supabase.from('stations').select('id, location')
        .eq('name', p.station).order('id').limit(1).maybeSingle());
      if (!st) { console.warn(`  ⚠ station "${p.station}" not found — run seed:stations. Skipping ${p.first}.`); continue; }
      const station = st as { id: number; location: string };
      await must(`walk_request ${p.first}`, supabase.from('walk_requests').insert({
        member_id: idOf(p), session_id: s.id, station_id: station.id, destination: station.location,
        leave_at: new Date(Date.now() + p.leaveInMin * 60_000).toISOString(), status: 'open',
      }));
      console.log(`  ✔ walk request: ${p.first} → ${p.station}, leaving in ${p.leaveInMin} min`);
    }
  }

  const blocked = PERSONAS.find((p) => p.blocked)!;
  const lead = PERSONAS.find((p) => p.lead)!;
  await must('blocklist', supabase.from('blocklist').upsert({
    handle_hash: sha256Hex(emailOf(blocked)), reason: BLOCK_REASON,
    confirmed_by_community: communityId, confirmed_by_member: idOf(lead),
  }, { onConflict: 'handle_hash', ignoreDuplicates: true }));
  console.log(`  ✔ ${blocked.first} on the blocklist (confirmed by ${lead.first}, lead)`);
  console.log(`\n✔ Demo personas ready: ${PERSONAS.map((p) => p.first).join(', ')} (all @${DOMAIN}, synthetic)`);
}

async function main(): Promise<void> {
  const { sqlOut, flags } = parseArgs();
  const reset = flags.has('reset');
  console.log(`Seeding ${PERSONAS.length} synthetic demo personas${reset ? ' (with --reset)' : ''}…`);
  if (sqlOut) {
    await writeSql(sqlOut, `Flock synthetic demo personas (@${DOMAIN})${reset ? ' with reset' : ''}`,
      [...(reset ? sqlReset() : []), ...sqlSeed()]);
    return;
  }
  await live(reset);
}

main().catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
