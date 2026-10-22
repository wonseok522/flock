// Discord: session threads, reminders, alerts and the /flock command.
// Gateway intent: Guilds only (no message content is read).
import { Client, Events, GatewayIntentBits, ChannelType } from 'discord.js';
import { config } from './config.js';
import { log, warn, error, errMsg } from './log.js';
import * as messages from '../messages.js';

const d = config.discord;
const NO_PINGS = { parse: [] }; // never ping @everyone/roles/users from generated copy
const clip = (s, max) => (s.length > max ? `${s.slice(0, max - 3)}...` : s);

let client = null;
let ready = false;
let failed = false;
let startedAt = 0;

export const discord = {
  get enabled() { return Boolean(d.token); },
  get ready() { return ready; },
  /** Still logging in (first 60 s after start). Jobs wait instead of skipping Discord. */
  get connecting() { return Boolean(d.token) && !ready && !failed && Date.now() - startedAt < 60_000; },
  get canThreads() { return ready && Boolean(d.sessionsChannelId); },
  get canAlert() { return ready && Boolean(d.alertChannelId); },
};

async function registerCommand() {
  if (!d.guildId) return;
  try {
    const guild = await client.guilds.fetch(d.guildId);
    await guild.commands.set([{ name: 'flock', description: 'Find a walk buddy for tonight' }]);
    log('discord', '/flock registered on the guild');
  } catch (e) {
    warn('discord', `could not register /flock (${errMsg(e)}). Was the bot invited with the applications.commands scope?`);
  }
}

/** Log in in the background; jobs that need Discord wait for `discord.ready`. */
export function startDiscord() {
  if (!d.token) return;
  startedAt = Date.now();
  client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once(Events.ClientReady, async (c) => {
    ready = true;
    log('discord', `connected as ${c.user.tag}`);
    await registerCommand();
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'flock') return;
    try {
      await interaction.reply({
        content: messages.slashReply({ sessionsUrl: config.webUrl ? `${config.webUrl}/sessions` : '' }),
        allowedMentions: NO_PINGS,
      });
    } catch (e) {
      error('discord', `/flock reply failed: ${errMsg(e)}`);
    }
  });

  client.on(Events.Error, (e) => error('discord', errMsg(e)));
  client.on(Events.ShardDisconnect, () => { warn('discord', 'disconnected (discord.js will reconnect)'); });
  client.on(Events.ShardResume, () => log('discord', 'reconnected'));

  client.login(d.token).catch((e) => {
    ready = false;
    failed = true;
    log('discord', `DISABLED: login failed (${errMsg(e)})`);
  });
}

async function textChannel(id) {
  const ch = await client.channels.fetch(id);
  if (!ch || !('send' in ch)) throw new Error(`channel ${id} is not a text channel the bot can see`);
  return ch;
}

/** Public thread in the sessions channel; returns the thread id. */
export async function createSessionThread(name, intro) {
  const channel = await textChannel(d.sessionsChannelId);
  if (!channel.threads) throw new Error('DISCORD_SESSIONS_CHANNEL_ID is not a channel that supports threads');
  const thread = await channel.threads.create({
    name: clip(name, 100),
    type: ChannelType.PublicThread,
    autoArchiveDuration: 1440,
    reason: 'Flock study session',
  });
  try {
    await thread.send({ content: clip(intro, 2000), allowedMentions: NO_PINGS });
  } catch (e) {
    warn('discord', `thread created but intro failed: ${errMsg(e)}`);
  }
  return thread.id;
}

export async function postToChannel(channelId, content) {
  const ch = await textChannel(channelId);
  await ch.send({ content: clip(content, 2000), allowedMentions: NO_PINGS });
}

export const postAlert = (content) => postToChannel(d.alertChannelId, content);

export async function stopDiscord() {
  if (client) await client.destroy().catch(() => {});
}
