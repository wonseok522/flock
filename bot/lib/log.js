// Labelled, London-time log lines: "21:04:07 [job-name] message".
// Never pass secrets (tokens, keys) or member emails to these functions.

const clock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
const stamp = () => clock.format(new Date());

export function log(tag, ...args) {
  console.log(`${stamp()} [${tag}]`, ...args);
}

export function warn(tag, ...args) {
  console.warn(`${stamp()} [${tag}] WARN`, ...args);
}

export function error(tag, ...args) {
  console.error(`${stamp()} [${tag}] ERROR`, ...args);
}

const seen = new Set();
/** Log a line only once per process (e.g. "integration disabled"). */
export function logOnce(key, tag, ...args) {
  if (seen.has(key)) return;
  seen.add(key);
  log(tag, ...args);
}

/** Short, safe message for any thrown value (no stack traces in normal logs). */
export function errMsg(e) {
  if (!e) return 'unknown error';
  if (typeof e === 'string') return e;
  const code = e.code ? ` (${e.code})` : '';
  return `${e.message ?? String(e)}${code}`;
}
