// Default copy. Grok Bot (task G6) may replace these strings.
//
// Rules for every string in this file (non-negotiable):
// - First names only. Never emails, member ids, handle hashes or addresses.
// - For SOS, "call 999" comes first.
// - Warm, short, plain English. No emoji.
// - The SOS location link is the only location that is ever posted.

/** "Amara" / "Amara and Ben" / "Amara, Ben and Chi" */
export function joinNames(names) {
  const list = (names ?? []).filter(Boolean);
  if (list.length === 0) return 'A Flock member';
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

const hasHave = (names) => ((names ?? []).filter(Boolean).length > 1 ? "haven't" : "hasn't");

// ── Session threads ──
export const sessionThreadName = ({ title, endsAt }) => `${title} · ends ${endsAt}`;

export const sessionIntro = ({ title, place, endsAt, walkUrl }) =>
  `Study session: "${title}"${place ? ` at ${place}` : ''}, until ${endsAt}.\n` +
  'Everyone here is a verified university student. When you finish, Flock matches you with someone ' +
  'heading the same way, or starts a check-in timer if you walk alone.' +
  (walkUrl ? `\n${walkUrl}` : '');

export const reminder = ({ walkUrl }) =>
  walkUrl
    ? `Heading out soon? Find someone going your way: ${walkUrl}`
    : 'Heading out soon? Open Flock to find someone going your way.';

// ── Incidents (session thread + alert channel) ──
export const missedWalk = ({ names, session, due }) =>
  `Check-in missed: ${joinNames(names)} ${hasHave(names)} confirmed they're home` +
  `${session ? ` from "${session}"` : ''}${due ? ` (due ${due})` : ''}. ` +
  "If you're with them or have heard from them, reply here. The society safety team has been told.";

export const missedSolo = ({ name, session, due }) =>
  `${name} was due home${due ? ` at ${due}` : ''}${session ? ` after "${session}"` : ''} and hasn't checked in yet. ` +
  "If you've heard from them, reply here. The society safety team has been told.";

export const sos = ({ name, session, mapUrl }) =>
  `SOS from ${name}. If anyone is with them: call 999.` +
  (session ? ` They were at "${session}".` : '') +
  (mapUrl ? `\nLocation they shared: ${mapUrl}` : '') +
  '\nThe society safety team has been told.';

// Reports never name anyone in Discord and are never posted in session threads.
export const reportAlert = ({ session }) =>
  `A report was filed${session ? ` from "${session}"` : ''}. ` +
  'It is in the Notion Incidents queue for the safety team. A person reviews it and decides; nothing happens automatically.';

export const escalation = ({ name, since, due }) =>
  `Escalating to the society safety team: ${name} hasn't checked in since ${since}` +
  `${due ? ` (was due home by ${due})` : ''}.`;

// ── Slash command ──
export const slashReply = ({ sessionsUrl }) =>
  sessionsUrl
    ? `${sessionsUrl} — find a walk buddy for tonight`
    : 'Open Flock and go to Sessions to find a walk buddy for tonight.';

// ── Notion (organisers only) ──
export const kindLabel = { missed_checkin: 'Missed check-in', help: 'SOS', report: 'Report' };

export const notionTitle = ({ kind, names, session }) =>
  [kindLabel[kind] ?? kind, (names ?? []).filter(Boolean).join(' & ') || null, session || null]
    .filter(Boolean)
    .join(' · ');

export const notionGrokPrompt =
  'Grok Bot: review this incident against the Safety Rules page and write your advice in "Grok recommendation". ' +
  'A human on the safety team decides what happens.';

export const notionEscalated = ({ at }) => `Escalated to the society safety team in Discord at ${at}.`;
export const notionResolved = ({ resolution }) => `Resolved in Flock${resolution ? `: ${resolution}` : '.'}`;
