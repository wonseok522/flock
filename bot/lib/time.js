// Every time shown to a human is 24h Europe/London.
const hm = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false,
});
const dmy = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric',
});

/** "21:45" */
export const hhmm = (d) => hm.format(new Date(d));
/** "22 Oct 2026" */
export const dayLabel = (d) => dmy.format(new Date(d));

export const nowIso = () => new Date().toISOString();
export const isoIn = (ms) => new Date(Date.now() + ms).toISOString();
export const isoAgo = (ms) => new Date(Date.now() - ms).toISOString();

export const SEC = 1000;
export const MIN = 60 * SEC;
export const HOUR = 60 * MIN;
