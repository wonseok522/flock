// Reads bot/.env (loaded by `node --env-file=.env`). Supabase is required;
// every other integration is optional and switches itself off with a log line.
import { log } from './log.js';

const env = (key) => (process.env[key] ?? '').trim();
const noSlash = (url) => url.replace(/\/+$/, '');

export const config = {
  supabaseUrl: env('SUPABASE_URL'),
  supabaseKey: env('SUPABASE_SERVICE_ROLE_KEY'),
  notion: {
    token: env('NOTION_TOKEN'),
    rulesPageId: env('NOTION_RULES_PAGE_ID'),
    incidentsDbId: env('NOTION_INCIDENTS_DB_ID'),
    dashboardDbId: env('NOTION_DASHBOARD_DB_ID'),
  },
  discord: {
    token: env('DISCORD_BOT_TOKEN'),
    guildId: env('DISCORD_GUILD_ID'),
    sessionsChannelId: env('DISCORD_SESSIONS_CHANNEL_ID'),
    alertChannelId: env('DISCORD_ALERT_CHANNEL_ID'),
  },
  cogneeUrl: noSlash(env('COGNEE_SERVICE_URL')),
  webUrl: noSlash(env('WEB_URL')),
};

/** Exits the process (code 1, no stack trace) if Supabase is not configured. */
export function requireSupabase() {
  const missing = [];
  if (!config.supabaseUrl) missing.push('SUPABASE_URL');
  if (!config.supabaseKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length) {
    console.error(
      `[config] Supabase vars missing: ${missing.join(', ')}.\n` +
      '[config] The Flock worker needs the Supabase URL and SERVICE ROLE key in bot/.env ' +
      '(Supabase -> Project Settings -> API). Nothing was started.',
    );
    process.exit(1);
  }
}

/** One line per optional integration that is switched off. */
export function logDisabledIntegrations() {
  const n = config.notion;
  const d = config.discord;
  if (!config.cogneeUrl) log('cognee', 'DISABLED: COGNEE_SERVICE_URL missing (match cards will show "Cognee reason unavailable")');
  if (!n.token) log('notion', 'DISABLED: NOTION_TOKEN missing');
  else {
    if (!n.incidentsDbId) log('notion', 'Incidents DISABLED: NOTION_INCIDENTS_DB_ID missing');
    if (!n.dashboardDbId) log('notion', 'Tonight dashboard DISABLED: NOTION_DASHBOARD_DB_ID missing');
    if (!n.rulesPageId) log('notion', 'Safety Rules check skipped: NOTION_RULES_PAGE_ID missing');
  }
  if (!d.token) log('discord', 'DISABLED: DISCORD_BOT_TOKEN missing');
  else {
    if (!d.sessionsChannelId) log('discord', 'Session threads + reminders DISABLED: DISCORD_SESSIONS_CHANNEL_ID missing');
    if (!d.alertChannelId) log('discord', 'Alert channel DISABLED: DISCORD_ALERT_CHANNEL_ID missing');
    if (!d.guildId) log('discord', '/flock command DISABLED: DISCORD_GUILD_ID missing');
  }
  if (!config.webUrl) log('config', 'WEB_URL missing: Discord messages will not include Flock links');
}
