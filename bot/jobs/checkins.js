// Jobs 6-7: missed check-ins become incidents (the incident fan-out job then
// posts them to Notion + Discord).
//  6. walks: active match past checkin_due_at   -> incident, status missed_checkin
//  7. solo:  overdue_solo_trips view            -> incident, status overdue
//     escalation: overdue > 10 min, not escalated -> alert channel
import { makeJob } from '../lib/job.js';
import { supabase, must, byIds, loadMatchContext, memberCommunity } from '../lib/supabase.js';
import { discord, postAlert } from '../lib/discord.js';
import { appendParagraph, notionEnabled } from '../lib/notion.js';
import { log, warn, errMsg } from '../lib/log.js';
import { hhmm, nowIso, isoAgo, MIN } from '../lib/time.js';
import * as messages from '../messages.js';

export const missedWalks = makeJob('missed-walks', async () => {
  const sb = supabase();
  const rows = must(
    await sb.from('matches').select('id, request_a, request_b, session_id, checkin_due_at')
      .eq('status', 'active').is('alerted_at', null).lt('checkin_due_at', nowIso()).limit(20),
    'select matches',
  );
  if (!rows.length) return;
  const ctx = await loadMatchContext(rows);
  const safe = must(
    await sb.from('checkins').select('match_id, member_id')
      .in('match_id', rows.map((m) => m.id)).eq('status', 'home_safe'),
    'select checkins',
  );
  const safeKey = new Set(safe.map((c) => `${c.match_id}:${c.member_id}`));

  for (const m of rows) {
    const c = ctx.get(m.id);
    const people = [c?.a, c?.b].filter(Boolean);
    const missing = people.filter((p) => !safeKey.has(`${m.id}:${p.memberId}`)).map((p) => p.firstName);
    const names = missing.length ? missing : people.map((p) => p.firstName);

    const claimed = must(
      await sb.from('matches').update({ status: 'missed_checkin', alerted_at: nowIso() })
        .eq('id', m.id).eq('status', 'active').is('alerted_at', null).select('id'),
      'claim match',
    );
    if (!claimed.length) continue;
    const { error } = await sb.from('incidents').insert({
      kind: 'missed_checkin',
      match_id: m.id,
      session_id: m.session_id,
      community_id: c?.session?.community_id ?? null,
      member_first_names: names,
    });
    if (error) {
      warn('missed-walks', `incident insert failed, releasing match ${m.id.slice(0, 6)}: ${error.message}`);
      await sb.from('matches').update({ status: 'active', alerted_at: null }).eq('id', m.id);
      continue;
    }
    log('missed-walks', `missed check-in: ${names.join(' & ')} (due ${hhmm(m.checkin_due_at)})`);
  }
});

export const overdueSolo = makeJob('overdue-solo', async () => {
  const sb = supabase();
  const rows = must(
    await sb.from('overdue_solo_trips').select('id, member_id, session_id, leave_at, eta_at').limit(20),
    'select overdue_solo_trips',
  );
  if (!rows.length) return;
  const [members, sessions] = await Promise.all([
    byIds('members', rows.map((t) => t.member_id), 'id, first_name'),
    byIds('study_sessions', rows.map((t) => t.session_id), 'id, community_id'),
  ]);
  for (const t of rows) {
    const name = members.get(t.member_id)?.first_name ?? 'A Flock member';
    const communityId = sessions.get(t.session_id)?.community_id ?? (await memberCommunity(t.member_id));
    const claimed = must(
      await sb.from('solo_trips').update({ status: 'overdue', alerted_at: nowIso() })
        .eq('id', t.id).eq('status', 'active').is('alerted_at', null).select('id'),
      'claim solo trip',
    );
    if (!claimed.length) continue;
    const { error } = await sb.from('incidents').insert({
      kind: 'missed_checkin',
      solo_trip_id: t.id,
      session_id: t.session_id,
      community_id: communityId,
      member_first_names: [name],
    });
    if (error) {
      warn('overdue-solo', `incident insert failed, releasing trip ${t.id.slice(0, 6)}: ${error.message}`);
      await sb.from('solo_trips').update({ status: 'active', alerted_at: null }).eq('id', t.id);
      continue;
    }
    log('overdue-solo', `${name} is overdue (ETA ${hhmm(t.eta_at)})`);
  }
});

export const escalateSolo = makeJob('escalate-solo', async () => {
  if (!discord.canAlert) return;
  const sb = supabase();
  const rows = must(
    await sb.from('solo_trips').select('id, member_id, leave_at, eta_at')
      .eq('status', 'overdue').is('escalated_at', null).lt('alerted_at', isoAgo(10 * MIN)).limit(10),
    'select solo_trips',
  );
  if (!rows.length) return;
  const members = await byIds('members', rows.map((t) => t.member_id), 'id, first_name');
  for (const t of rows) {
    const name = members.get(t.member_id)?.first_name ?? 'A Flock member';
    const claimed = must(
      await sb.from('solo_trips').update({ escalated_at: nowIso() })
        .eq('id', t.id).is('escalated_at', null).select('id'),
      'claim escalation',
    );
    if (!claimed.length) continue;
    try {
      await postAlert(messages.escalation({ name, since: hhmm(t.leave_at), due: hhmm(t.eta_at) }));
      log('escalate-solo', `escalated: ${name}`);
    } catch (e) {
      warn('escalate-solo', `${name}: ${errMsg(e)} (will retry)`);
      await sb.from('solo_trips').update({ escalated_at: null }).eq('id', t.id);
      continue;
    }
    // Best effort: note the escalation on the Notion incident page.
    if (!notionEnabled) continue;
    try {
      const inc = must(
        await sb.from('incidents').select('notion_page_id').eq('solo_trip_id', t.id)
          .not('notion_page_id', 'is', null).limit(1),
        'select incident',
      );
      if (inc[0]) await appendParagraph(inc[0].notion_page_id, messages.notionEscalated({ at: hhmm(new Date()) }));
    } catch (e) {
      warn('escalate-solo', `Notion note failed: ${errMsg(e)}`);
    }
  }
});
