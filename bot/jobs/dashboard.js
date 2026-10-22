// Job 11: Notion "Tonight" dashboard. One row per session ending between
// now-6h and now+12h, keyed by Session = "<title> · <HH:MM>". Only writes when
// a number changed (Notion allows ~3 requests/s).
import { makeJob } from '../lib/job.js';
import { supabase, must } from '../lib/supabase.js';
import { dashboardDb, findDashboardRow } from '../lib/notion.js';
import { log, logOnce, warn, errMsg } from '../lib/log.js';
import { hhmm, isoAgo, isoIn, HOUR } from '../lib/time.js';

const pageIds = new Map(); // row title -> Notion page id
const lastValues = new Map(); // row title -> JSON of last written numbers

function countBy(rows, key) {
  const out = new Map();
  for (const r of rows) out.set(r[key], (out.get(r[key]) ?? 0) + 1);
  return out;
}

export const dashboard = makeJob('notion-dashboard', async () => {
  if (!dashboardDb.enabled) {
    logOnce('dashboard-off', 'notion-dashboard', 'DISABLED: needs NOTION_TOKEN and NOTION_DASHBOARD_DB_ID');
    return;
  }
  const sb = supabase();
  const sessions = must(
    await sb.from('study_sessions').select('id, title, ends_at')
      .gte('ends_at', isoAgo(6 * HOUR)).lte('ends_at', isoIn(12 * HOUR)).order('ends_at').limit(30),
    'select study_sessions',
  );
  if (!sessions.length) return;
  const ids = sessions.map((s) => s.id);

  const [walks, matches, missed] = await Promise.all([
    sb.from('walk_requests').select('session_id, member_id').in('session_id', ids),
    sb.from('matches').select('session_id, seconds_to_match').in('session_id', ids),
    sb.from('incidents').select('session_id').eq('kind', 'missed_checkin').in('session_id', ids),
  ]).then(([w, m, i]) => [must(w, 'select walk_requests'), must(m, 'select matches'), must(i, 'select incidents')]);

  // Walkers = distinct people who asked for a walk (re-requests cancel + recreate rows).
  const walkers = new Map();
  for (const w of walks) {
    if (!walkers.has(w.session_id)) walkers.set(w.session_id, new Set());
    walkers.get(w.session_id).add(w.member_id);
  }
  const matchCount = countBy(matches, 'session_id');
  const missedCount = countBy(missed, 'session_id');

  for (const s of sessions) {
    const title = `${s.title} · ${hhmm(s.ends_at)}`;
    const secs = matches.filter((m) => m.session_id === s.id && m.seconds_to_match != null).map((m) => m.seconds_to_match);
    const values = {
      Walkers: walkers.get(s.id)?.size ?? 0,
      Matches: matchCount.get(s.id) ?? 0,
      'Avg seconds to match': secs.length ? Math.round(secs.reduce((a, b) => a + b, 0) / secs.length) : null,
      'Missed check-ins': missedCount.get(s.id) ?? 0,
    };
    const json = JSON.stringify(values);
    if (lastValues.get(title) === json) continue;
    try {
      let pageId = pageIds.get(title) ?? (await findDashboardRow(title));
      if (pageId) {
        await dashboardDb.updatePage(pageId, values);
      } else {
        pageId = await dashboardDb.createPage({ $title: title, ...values });
        log('notion-dashboard', `row added: ${title}`);
      }
      pageIds.set(title, pageId);
      lastValues.set(title, json);
    } catch (e) {
      pageIds.delete(title); // stale id (row deleted in Notion): look it up again next time
      warn('notion-dashboard', `${title}: ${errMsg(e)}`);
    }
  }
});
