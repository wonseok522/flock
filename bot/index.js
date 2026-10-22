// Flock worker. One process on the demo laptop that does every server-side job
// the web app (on Vercel) can't: Supabase (service role) <-> Cognee, Notion, Discord.
// Every job is idempotent (driven by *_at / status columns). Supabase Realtime
// triggers them with low latency; a polling loop is the safety net.
//
// Start: npm start   (= node --env-file=.env index.js)
import { config, requireSupabase, logDisabledIntegrations } from './lib/config.js';
import { log, warn, error, errMsg } from './lib/log.js';

requireSupabase(); // exits with a clear message if Supabase vars are missing

const { supabase } = await import('./lib/supabase.js');
const { runAt, clearTimers } = await import('./lib/job.js');
const { startDiscord, stopDiscord } = await import('./lib/discord.js');
const { checkRulesPage } = await import('./lib/notion.js');
const { rememberJoins, trustReasons, rememberSafeWalks } = await import('./jobs/cognee.js');
const { sessionThreads, reminders } = await import('./jobs/sessions.js');
const { missedWalks, overdueSolo, escalateSolo } = await import('./jobs/checkins.js');
const { incidentFanout, resolvedSync, grokSync } = await import('./jobs/incidents.js');
const { dashboard } = await import('./jobs/dashboard.js');

const POLL_MS = 15_000;
const GROK_SYNC_MS = 30_000;
const DASHBOARD_MS = 60_000;
const REMINDER_LEAD_MS = 15 * 60_000;

const coreJobs = [
  rememberJoins, trustReasons, rememberSafeWalks,
  sessionThreads, reminders,
  missedWalks, overdueSolo, escalateSolo,
  incidentFanout, resolvedSync,
];

process.on('unhandledRejection', (e) => error('worker', `unhandled: ${errMsg(e)}`));

log('worker', 'Flock worker starting');
logDisabledIntegrations();

const sb = supabase();

// Connectivity check (does not exit: the polling loop keeps retrying).
{
  const { error: e } = await sb.from('settings').select('key').limit(1);
  if (e) warn('supabase', `cannot read the database yet: ${e.message}. Check SUPABASE_URL / key and that schema.sql ran.`);
  else log('supabase', `connected to ${new URL(config.supabaseUrl).host}`);
}

startDiscord();
checkRulesPage();

// ── Realtime (service role sees every row) ──
const pg = (table, event) => ({ event, schema: 'public', table });
const channel = sb
  .channel('flock-worker')
  .on('postgres_changes', pg('session_members', 'INSERT'), () => rememberJoins.run())
  .on('postgres_changes', pg('matches', 'INSERT'), ({ new: m }) => {
    trustReasons.run();
    if (m?.checkin_due_at) runAt(missedWalks, m.checkin_due_at);
  })
  .on('postgres_changes', pg('matches', 'UPDATE'), ({ new: m }) => {
    if (m?.status === 'home_safe') rememberSafeWalks.run();
  })
  .on('postgres_changes', pg('study_sessions', 'INSERT'), ({ new: s }) => {
    sessionThreads.run();
    if (s?.ends_at) runAt(reminders, new Date(new Date(s.ends_at).getTime() - REMINDER_LEAD_MS));
  })
  .on('postgres_changes', pg('solo_trips', 'INSERT'), ({ new: t }) => {
    if (t?.eta_at) runAt(overdueSolo, t.eta_at);
  })
  .on('postgres_changes', pg('incidents', 'INSERT'), () => incidentFanout.run())
  .on('postgres_changes', pg('incidents', 'UPDATE'), ({ new: i }) => {
    if (i?.status === 'resolved') resolvedSync.run();
  })
  .subscribe((status, err) => {
    if (status === 'SUBSCRIBED') log('realtime', 'subscribed (matches, incidents, sessions, members, solo trips)');
    else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      warn('realtime', `${status}${err ? `: ${errMsg(err)}` : ''}. Polling every ${POLL_MS / 1000} s covers it.`);
    } else if (status === 'CLOSED') log('realtime', 'closed');
  });

// ── Polling safety net ──
const runAll = (jobs) => jobs.forEach((j) => j.run());
runAll(coreJobs);
grokSync.run();
dashboard.run();
const intervals = [
  setInterval(() => runAll(coreJobs), POLL_MS),
  setInterval(() => grokSync.run(), GROK_SYNC_MS),
  setInterval(() => dashboard.run(), DASHBOARD_MS),
];
log('worker', `running: Realtime + polling every ${POLL_MS / 1000} s (Grok sync ${GROK_SYNC_MS / 1000} s, dashboard ${DASHBOARD_MS / 1000} s)`);

// ── Shutdown ──
let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log('worker', `${signal}: stopping`);
  intervals.forEach(clearInterval);
  clearTimers();
  await sb.removeChannel(channel).catch(() => {});
  await stopDiscord();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
