// A job is an idempotent async function driven by *_at / status columns.
// run() can be called from Realtime, timers and the polling loop at the same
// time: calls are coalesced, so one job never runs twice concurrently, and a
// trigger that arrives mid-run causes exactly one more pass.
import { error, errMsg } from './log.js';

export function makeJob(name, fn) {
  let running = false;
  let again = false;
  let lastErr = '';
  let lastErrAt = 0;

  async function run() {
    if (running) { again = true; return; }
    running = true;
    try {
      do {
        again = false;
        try {
          await fn();
          lastErr = '';
        } catch (e) {
          // Same error every poll (e.g. a service is down): log it once a minute.
          const msg = errMsg(e);
          if (msg !== lastErr || Date.now() - lastErrAt > 60_000) {
            error(name, msg + (msg === lastErr ? ' (still failing)' : ''));
            lastErr = msg;
            lastErrAt = Date.now();
          }
        }
      } while (again);
    } finally {
      running = false;
    }
  }

  return { name, run };
}

const timers = new Set();
const MAX_DELAY = 3 * 60 * 60 * 1000;

/** Run a job shortly after `when` (so a demo deadline fires on time, not on the next poll). */
export function runAt(job, when, extraMs = 1500) {
  const delay = new Date(when).getTime() - Date.now() + extraMs;
  if (!Number.isFinite(delay) || delay > MAX_DELAY) return;
  const t = setTimeout(() => { timers.delete(t); job.run(); }, Math.max(0, delay));
  t.unref?.();
  timers.add(t);
}

export function clearTimers() {
  for (const t of timers) clearTimeout(t);
  timers.clear();
}
