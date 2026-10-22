// Jobs 1-3: community memory in Cognee.
//  1. session joins       -> POST /remember, set session_members.remembered_at
//  2. new match           -> POST /trust,    set matches.reason + reason_source
//  3. safe walk (home_safe) -> POST /remember, set matches.remembered_at
import { makeJob } from '../lib/job.js';
import { supabase, must, byIds, loadMatchContext } from '../lib/supabase.js';
import { cognee, cleanReason, tag } from '../lib/cognee.js';
import { log, logOnce, errMsg } from '../lib/log.js';
import { dayLabel, nowIso, isoAgo, HOUR } from '../lib/time.js';

const BATCH = 25;

export const rememberJoins = makeJob('cognee-joins', async () => {
  const sb = supabase();
  const rows = must(
    await sb.from('session_members').select('session_id, member_id, joined_at')
      .is('remembered_at', null).order('joined_at').limit(BATCH),
    'select session_members',
  );
  if (!rows.length) return;
  if (!cognee.enabled) {
    logOnce('cognee-joins-off', 'cognee-joins', `skipped ${rows.length}+ joins: Cognee DISABLED`);
    return;
  }
  const [members, sessions] = await Promise.all([
    byIds('members', rows.map((r) => r.member_id), 'id, first_name'),
    byIds('study_sessions', rows.map((r) => r.session_id), 'id, title'),
  ]);
  for (const r of rows) {
    const name = members.get(r.member_id)?.first_name ?? 'A member';
    const title = sessions.get(r.session_id)?.title ?? 'a study session';
    const text = `${name} ${tag('m', r.member_id)} studied at "${title}" ${tag('s', r.session_id)} on ${dayLabel(r.joined_at)}.`;
    try {
      await cognee.remember(text);
    } catch (e) {
      log('cognee-joins', `Cognee unreachable, will retry next loop (${errMsg(e)})`);
      return; // Cognee is probably down; don't hammer it
    }
    must(
      await sb.from('session_members').update({ remembered_at: nowIso() })
        .eq('session_id', r.session_id).eq('member_id', r.member_id).is('remembered_at', null),
      'update session_members',
    );
    log('cognee-joins', `remembered: ${name} joined "${title}"`);
  }
});

export const trustReasons = makeJob('cognee-trust', async () => {
  const sb = supabase();
  const rows = must(
    await sb.from('matches').select('id, request_a, request_b, session_id, created_at')
      .is('reason_source', null).gt('created_at', isoAgo(6 * HOUR)).order('created_at').limit(BATCH),
    'select matches',
  );
  if (!rows.length) return;
  const ctx = await loadMatchContext(rows);

  await Promise.all(rows.map(async (m) => {
    const c = ctx.get(m.id);
    let reason = null;
    const started = Date.now();
    if (!cognee.enabled) {
      logOnce('cognee-trust-off', 'cognee-trust', 'Cognee DISABLED: matches get reason_source=unavailable (labelled on the card)');
    } else if (c?.a && c?.b) {
      try {
        const res = await cognee.trust({
          member_a: { id: c.a.memberId, first_name: c.a.firstName },
          member_b: { id: c.b.memberId, first_name: c.b.firstName },
          session_title: c.session?.title ?? null,
        });
        reason = cleanReason(res?.reason);
      } catch (e) {
        log('cognee-trust', `match ${m.id.slice(0, 6)}: Cognee unavailable (${errMsg(e)})`);
      }
    }
    const source = reason ? 'cognee' : 'unavailable';
    must(
      await sb.from('matches').update({ reason, reason_source: source })
        .eq('id', m.id).is('reason_source', null),
      'update matches.reason',
    );
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    log('cognee-trust', `match ${m.id.slice(0, 6)} (${c?.a?.firstName ?? '?'} + ${c?.b?.firstName ?? '?'}): ${source} in ${secs} s`);
  }));
});

export const rememberSafeWalks = makeJob('cognee-safe-walks', async () => {
  const sb = supabase();
  const rows = must(
    await sb.from('matches').select('id, request_a, request_b, session_id, created_at')
      .eq('status', 'home_safe').is('remembered_at', null).order('created_at').limit(BATCH),
    'select matches',
  );
  if (!rows.length) return;
  if (!cognee.enabled) {
    logOnce('cognee-walks-off', 'cognee-safe-walks', `skipped ${rows.length}+ safe walks: Cognee DISABLED`);
    return;
  }
  const ctx = await loadMatchContext(rows);
  for (const m of rows) {
    const c = ctx.get(m.id);
    if (!c?.a || !c?.b) continue;
    const title = c.session?.title ?? 'a study session';
    const towards = [c.a.station, c.b.station].filter(Boolean);
    const text =
      `${c.a.firstName} ${tag('m', c.a.memberId)} and ${c.b.firstName} ${tag('m', c.b.memberId)} ` +
      `walked home safely together from "${title}" ${tag('s', m.session_id)}` +
      `${towards.length ? ` towards ${[...new Set(towards)].join(' and ')}` : ''} on ${dayLabel(m.created_at)}.`;
    try {
      await cognee.remember(text);
    } catch (e) {
      log('cognee-safe-walks', `Cognee unreachable, will retry next loop (${errMsg(e)})`);
      return;
    }
    must(
      await sb.from('matches').update({ remembered_at: nowIso() }).eq('id', m.id).is('remembered_at', null),
      'update matches.remembered_at',
    );
    log('cognee-safe-walks', `remembered: ${c.a.firstName} and ${c.b.firstName} got home safe`);
  }
});
