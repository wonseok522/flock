// Jobs 8-10: incidents out to Notion + Discord, and back from Notion.
//  8. fan-out: incidents.alerted_at null -> Notion page (+ notion_page_id) and
//     Discord (session thread + alert channel). alerted_at is set once at least
//     one channel worked; otherwise retried next loop. A missing Notion page is
//     backfilled for 6 h.
//  9. resolved in Flock -> Notion Status "resolved".
// 10. Grok Bot writes "Grok recommendation" in Notion -> incidents.grok_recommendation.
import { makeJob } from '../lib/job.js';
import { supabase, must, byIds } from '../lib/supabase.js';
import { discord, postToChannel, postAlert } from '../lib/discord.js';
import { incidentsDb, appendParagraph, pageStatus, openRecommendations } from '../lib/notion.js';
import { config } from '../lib/config.js';
import { parsePoint, osmLink } from '../lib/geo.js';
import { log, logOnce, warn, errMsg } from '../lib/log.js';
import { hhmm, dayLabel, nowIso, isoAgo, HOUR } from '../lib/time.js';
import * as messages from '../messages.js';

const NOTION_MAX_TRIES = 5;
const notionFailures = new Map();

function discordText(inc, ctx) {
  const names = inc.member_first_names ?? [];
  const session = ctx.session?.title ?? null;
  if (inc.kind === 'help') return messages.sos({ name: messages.joinNames(names), session, mapUrl: ctx.mapUrl });
  if (inc.kind === 'report') return messages.reportAlert({ session });
  if (inc.solo_trip_id) return messages.missedSolo({ name: messages.joinNames(names), session, due: ctx.due });
  return messages.missedWalk({ names, session, due: ctx.due });
}

export const incidentFanout = makeJob('incidents', async () => {
  const sb = supabase();
  const notionOn = incidentsDb.enabled;
  let q = sb.from('incidents').select(
    'id, kind, match_id, solo_trip_id, report_id, session_id, member_first_names, sos_location, notion_page_id, alerted_at, created_at',
  );
  q = notionOn
    ? q.or(`alerted_at.is.null,and(notion_page_id.is.null,created_at.gt.${isoAgo(6 * HOUR)})`)
    : q.is('alerted_at', null);
  const rows = must(await q.order('created_at').limit(20), 'select incidents');
  if (!rows.length) return;
  if (!notionOn && !discord.enabled) {
    logOnce('incidents-off', 'incidents', 'Notion and Discord both DISABLED: incidents stay in Supabase (organiser dashboard only)');
    return;
  }

  const [sessions, trips, matches, reports] = await Promise.all([
    byIds('study_sessions', rows.map((i) => i.session_id), 'id, title, discord_thread_id'),
    byIds('solo_trips', rows.map((i) => i.solo_trip_id), 'id, eta_at'),
    byIds('matches', rows.map((i) => i.match_id), 'id, checkin_due_at'),
    byIds('reports', rows.map((i) => i.report_id), 'id, kind, evidence'),
  ]);

  for (const inc of rows) {
    const names = inc.member_first_names ?? [];
    const session = sessions.get(inc.session_id) ?? null;
    const dueAt = inc.solo_trip_id ? trips.get(inc.solo_trip_id)?.eta_at : matches.get(inc.match_id)?.checkin_due_at;
    let mapUrl = null;
    if (inc.kind === 'help' && inc.sos_location) {
      const point = parsePoint(inc.sos_location);
      if (point) mapUrl = osmLink(point);
      else warn('incidents', `SOS location format not recognised (${typeof inc.sos_location}); posting without a map link`);
    }
    const text = discordText(inc, { session, due: dueAt ? hhmm(dueAt) : null, mapUrl });

    // (a) Notion
    let notionOk = Boolean(inc.notion_page_id);
    const tries = notionFailures.get(inc.id) ?? 0;
    if (notionOn && !inc.notion_page_id && tries < NOTION_MAX_TRIES) {
      try {
        const report = reports.get(inc.report_id);
        const pageId = await incidentsDb.createPage(
          {
            $title: messages.notionTitle({ kind: inc.kind, names, session: session?.title }),
            Kind: inc.kind,
            Members: names.join(', '),
            Session: session?.title ?? '',
            Status: 'open',
            Created: inc.created_at,
          },
          [
            inc.kind === 'report'
              ? `Report (${report?.kind ?? 'unknown'}) about ${messages.joinNames(names)}. Evidence from the reporter: ${report?.evidence ?? 'not available'}`
              : text,
            `When: ${hhmm(inc.created_at)}, ${dayLabel(inc.created_at)} (London)`,
            `Flock incident: ${inc.id}`,
            messages.notionGrokPrompt,
          ],
        );
        must(
          await sb.from('incidents').update({ notion_page_id: pageId }).eq('id', inc.id).is('notion_page_id', null),
          'update incidents.notion_page_id',
        );
        notionFailures.delete(inc.id);
        notionOk = true;
        log('incidents', `Notion page created: ${messages.notionTitle({ kind: inc.kind, names, session: session?.title })}`);
      } catch (e) {
        notionFailures.set(inc.id, tries + 1);
        warn('incidents', `Notion failed (try ${tries + 1}/${NOTION_MAX_TRIES}): ${errMsg(e)}`);
      }
    }

    if (inc.alerted_at) continue; // Notion backfill only; Discord already done

    // (b) Discord. While the bot is still logging in, wait instead of skipping it.
    if (discord.connecting) continue;
    let discordOk = false;
    if (discord.ready) {
      const targets = [];
      if (session?.discord_thread_id && inc.kind !== 'report') targets.push(['session thread', session.discord_thread_id]);
      if (config.discord.alertChannelId) targets.push(['alert channel', config.discord.alertChannelId]);
      for (const [label, channelId] of targets) {
        try {
          await postToChannel(channelId, text);
          discordOk = true;
        } catch (e) {
          warn('incidents', `Discord ${label} failed: ${errMsg(e)}`);
        }
      }
    }

    if (notionOk || discordOk) {
      must(
        await sb.from('incidents').update({ alerted_at: nowIso() }).eq('id', inc.id).is('alerted_at', null),
        'update incidents.alerted_at',
      );
      log('incidents', `${inc.kind} alerted (${[notionOk && 'Notion', discordOk && 'Discord'].filter(Boolean).join(' + ')}): ${messages.joinNames(names)}`);
    }
  }
});

const syncedResolved = new Set();

export const resolvedSync = makeJob('notion-resolved', async () => {
  if (!incidentsDb.enabled) return;
  const sb = supabase();
  const rows = must(
    await sb.from('incidents').select('id, notion_page_id, resolution')
      .eq('status', 'resolved').not('notion_page_id', 'is', null).gt('created_at', isoAgo(48 * HOUR)).limit(100),
    'select incidents',
  );
  for (const r of rows) {
    if (syncedResolved.has(r.id)) continue;
    try {
      const status = await pageStatus(r.notion_page_id);
      if (status !== 'resolved') {
        await incidentsDb.updatePage(r.notion_page_id, { Status: 'resolved' });
        await appendParagraph(r.notion_page_id, messages.notionResolved({ resolution: r.resolution }));
        log('notion-resolved', `incident ${r.id.slice(0, 6)} marked resolved in Notion`);
      }
      syncedResolved.add(r.id);
    } catch (e) {
      warn('notion-resolved', `incident ${r.id.slice(0, 6)}: ${errMsg(e)}`);
    }
  }
});

export const grokSync = makeJob('grok-sync', async () => {
  if (!incidentsDb.enabled) return;
  const recs = (await openRecommendations()).filter((r) => r.recommendation);
  if (!recs.length) return;
  const sb = supabase();
  const rows = must(
    await sb.from('incidents').select('id, notion_page_id, grok_recommendation')
      .in('notion_page_id', recs.map((r) => r.pageId)),
    'select incidents',
  );
  const byPage = new Map(rows.map((r) => [r.notion_page_id, r]));
  for (const rec of recs) {
    const inc = byPage.get(rec.pageId);
    if (!inc || inc.grok_recommendation === rec.recommendation) continue;
    must(
      await sb.from('incidents').update({ grok_recommendation: rec.recommendation }).eq('id', inc.id),
      'update incidents.grok_recommendation',
    );
    log('grok-sync', `Grok Bot recommendation synced for incident ${inc.id.slice(0, 6)}`);
  }
});
