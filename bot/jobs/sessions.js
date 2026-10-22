// Jobs 4-5: Discord thread per study session + "heading out soon?" reminder.
import { makeJob } from '../lib/job.js';
import { supabase, must } from '../lib/supabase.js';
import { discord, createSessionThread, postToChannel } from '../lib/discord.js';
import { config } from '../lib/config.js';
import { log, logOnce, warn, errMsg } from '../lib/log.js';
import { hhmm, nowIso, isoIn, HOUR, MIN } from '../lib/time.js';
import * as messages from '../messages.js';

// Only sessions ending in the next 24 h get a thread, so a bulk Luma import
// doesn't create dozens of threads at once. Later sessions are picked up as
// they enter the window.
const THREAD_WINDOW = 24 * HOUR;
const walkUrl = (id) => (config.webUrl ? `${config.webUrl}/sessions/${id}/walk` : '');

// Threads created but not yet saved (Supabase write failed): reuse, never duplicate.
const unsaved = new Map();

export const sessionThreads = makeJob('discord-threads', async () => {
  if (!discord.canThreads) {
    if (!discord.enabled || !config.discord.sessionsChannelId) {
      logOnce('threads-off', 'discord-threads', 'DISABLED: needs DISCORD_BOT_TOKEN and DISCORD_SESSIONS_CHANNEL_ID');
    }
    return; // not connected yet: next loop
  }
  const sb = supabase();
  const rows = must(
    await sb.from('study_sessions').select('id, title, location_name, ends_at')
      .is('discord_thread_id', null).gt('ends_at', nowIso()).lt('ends_at', isoIn(THREAD_WINDOW))
      .order('ends_at').limit(10),
    'select study_sessions',
  );
  for (const s of rows) {
    try {
      let threadId = unsaved.get(s.id);
      if (!threadId) {
        threadId = await createSessionThread(
          messages.sessionThreadName({ title: s.title, endsAt: hhmm(s.ends_at) }),
          messages.sessionIntro({ title: s.title, place: s.location_name, endsAt: hhmm(s.ends_at), walkUrl: walkUrl(s.id) }),
        );
        unsaved.set(s.id, threadId);
      }
      must(
        await sb.from('study_sessions').update({ discord_thread_id: threadId })
          .eq('id', s.id).is('discord_thread_id', null),
        'update study_sessions.discord_thread_id',
      );
      unsaved.delete(s.id);
      log('discord-threads', `thread created for "${s.title}" (ends ${hhmm(s.ends_at)})`);
    } catch (e) {
      warn('discord-threads', `"${s.title}": ${errMsg(e)}`);
    }
  }
});

export const reminders = makeJob('discord-reminders', async () => {
  if (!discord.ready) return;
  const sb = supabase();
  const rows = must(
    await sb.from('study_sessions').select('id, title, ends_at, discord_thread_id')
      .is('reminder_sent_at', null).not('discord_thread_id', 'is', null)
      .gt('ends_at', nowIso()).lte('ends_at', isoIn(15 * MIN)).limit(20),
    'select study_sessions',
  );
  for (const s of rows) {
    // Claim first so a re-run never double-posts; release the claim if Discord fails.
    const claimed = must(
      await sb.from('study_sessions').update({ reminder_sent_at: nowIso() })
        .eq('id', s.id).is('reminder_sent_at', null).select('id'),
      'claim reminder',
    );
    if (!claimed.length) continue;
    try {
      await postToChannel(s.discord_thread_id, messages.reminder({ walkUrl: walkUrl(s.id) }));
      log('discord-reminders', `reminder posted for "${s.title}" (ends ${hhmm(s.ends_at)})`);
    } catch (e) {
      warn('discord-reminders', `"${s.title}": ${errMsg(e)} (will retry)`);
      await sb.from('study_sessions').update({ reminder_sent_at: null }).eq('id', s.id);
    }
  }
});
