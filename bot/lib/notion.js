// Notion Safety HQ: Incidents database + Tonight dashboard database.
// Property names and types must match bot/notion-schema.md (Grok Bot creates them).
// Works with @notionhq/client v5 (API 2025-09-03, data sources). A database ID
// or a data source ID may be pasted into bot/.env; both are resolved here.
import { Client, LogLevel } from '@notionhq/client';
import { config } from './config.js';
import { log, warn, logOnce, errMsg } from './log.js';

const n = config.notion;
const client = n.token ? new Client({ auth: n.token, timeoutMs: 15_000, logLevel: LogLevel.ERROR }) : null;

const EXPECTED = {
  incidents: {
    title: 'Title',
    props: {
      Kind: ['select'],
      Members: ['rich_text'],
      Session: ['rich_text'],
      Status: ['select', 'status'],
      Created: ['date'],
      'Grok recommendation': ['rich_text'],
    },
  },
  dashboard: {
    title: 'Session',
    props: {
      Walkers: ['number'],
      Matches: ['number'],
      'Avg seconds to match': ['number'],
      'Missed check-ins': ['number'],
    },
  },
};

const clip = (s, max = 2000) => String(s ?? '').slice(0, max);
const richText = (s) => [{ type: 'text', text: { content: clip(s) } }];
const plain = (arr) => (Array.isArray(arr) ? arr.map((t) => t.plain_text ?? '').join('') : '');

class NotionDb {
  constructor(kind, id) {
    this.kind = kind;
    this.id = id;
    this.schema = null; // { dsId, titleName, types }
  }

  get enabled() { return Boolean(client && this.id); }

  async resolve() {
    if (this.schema) return this.schema;
    let dsId = this.id;
    try {
      const db = await client.databases.retrieve({ database_id: this.id });
      if (db.data_sources?.length) dsId = db.data_sources[0].id;
    } catch {
      // Not a database id (or not shared yet): try it as a data source id below.
    }
    let ds;
    try {
      ds = await client.dataSources.retrieve({ data_source_id: dsId });
    } catch (e) {
      throw new Error(`cannot open the ${this.kind} database (${errMsg(e)}). Is the ID right and the database shared with the integration?`);
    }
    const types = Object.fromEntries(Object.entries(ds.properties ?? {}).map(([k, v]) => [k, v.type]));
    const titleName = Object.keys(types).find((k) => types[k] === 'title');
    const exp = EXPECTED[this.kind];
    if (titleName !== exp.title) {
      warn('notion', `${this.kind} DB: title property is "${titleName}", expected "${exp.title}" (using "${titleName}"; see bot/notion-schema.md)`);
    }
    for (const [name, allowed] of Object.entries(exp.props)) {
      if (!types[name]) warn('notion', `${this.kind} DB is missing property "${name}" (${allowed[0]}). See bot/notion-schema.md`);
      else if (!allowed.includes(types[name])) warn('notion', `${this.kind} DB property "${name}" is ${types[name]}, expected ${allowed.join(' or ')}`);
    }
    this.schema = { dsId, titleName, types };
    log('notion', `${this.kind} database connected`);
    return this.schema;
  }

  /** Build a Notion properties object, skipping properties the DB doesn't have. */
  props(values, schema) {
    const out = {};
    for (const [name, value] of Object.entries(values)) {
      const key = name === '$title' ? schema.titleName : name;
      const type = schema.types[key];
      if (!type) continue;
      if (type === 'title') out[key] = { title: richText(value) };
      else if (type === 'rich_text') out[key] = { rich_text: richText(value) };
      else if (type === 'select') out[key] = { select: value == null ? null : { name: clip(value, 100) } };
      else if (type === 'status') out[key] = { status: { name: clip(value, 100) } };
      else if (type === 'number') out[key] = { number: value == null ? null : Number(value) };
      else if (type === 'date') out[key] = { date: value ? { start: value } : null };
    }
    return out;
  }

  statusFilter(schema, name) {
    return schema.types.Status === 'status'
      ? { property: 'Status', status: { equals: name } }
      : { property: 'Status', select: { equals: name } };
  }

  async createPage(values, paragraphs = []) {
    const schema = await this.resolve();
    const page = await client.pages.create({
      parent: { type: 'data_source_id', data_source_id: schema.dsId },
      properties: this.props(values, schema),
      children: paragraphs.filter(Boolean).map((p) => ({
        object: 'block', type: 'paragraph', paragraph: { rich_text: richText(p) },
      })),
    });
    return page.id;
  }

  async updatePage(pageId, values) {
    const schema = await this.resolve();
    await client.pages.update({ page_id: pageId, properties: this.props(values, schema) });
  }

  async query(filter, pageSize = 100) {
    const schema = await this.resolve();
    const res = await client.dataSources.query({ data_source_id: schema.dsId, filter, page_size: pageSize });
    return res.results ?? [];
  }
}

export const incidentsDb = new NotionDb('incidents', n.incidentsDbId);
export const dashboardDb = new NotionDb('dashboard', n.dashboardDbId);

export async function appendParagraph(pageId, text) {
  await client.blocks.children.append({
    block_id: pageId,
    children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: richText(text) } }],
  });
}

export async function pageStatus(pageId) {
  const page = await client.pages.retrieve({ page_id: pageId });
  const p = page.properties?.Status;
  return p?.select?.name ?? p?.status?.name ?? null;
}

/** Open incidents with a non-empty "Grok recommendation": [{pageId, recommendation}]. */
export async function openRecommendations() {
  const schema = await incidentsDb.resolve();
  if (schema.types['Grok recommendation'] !== 'rich_text') {
    logOnce('notion-no-grok-prop', 'grok-sync', 'skipped: Incidents DB has no "Grok recommendation" rich_text property');
    return [];
  }
  const pages = await incidentsDb.query({
    and: [
      incidentsDb.statusFilter(schema, 'open'),
      { property: 'Grok recommendation', rich_text: { is_not_empty: true } },
    ],
  });
  return pages.map((p) => ({ pageId: p.id, recommendation: plain(p.properties?.['Grok recommendation']?.rich_text).trim() }));
}

/** Dashboard row page id by its title ("<title> · <HH:MM>"), or null. */
export async function findDashboardRow(title) {
  const schema = await dashboardDb.resolve();
  const rows = await dashboardDb.query({ property: schema.titleName, title: { equals: title } }, 1);
  return rows[0]?.id ?? null;
}

/** Startup check: the Safety Rules page Grok Bot reads is reachable. */
export async function checkRulesPage() {
  if (!client || !n.rulesPageId) return;
  try {
    const page = await client.pages.retrieve({ page_id: n.rulesPageId });
    const titleProp = Object.values(page.properties ?? {}).find((p) => p.type === 'title');
    log('notion', `Safety Rules page reachable: "${plain(titleProp?.title) || 'untitled'}"`);
  } catch (e) {
    warn('notion', `Safety Rules page not reachable (${errMsg(e)}). Share it with the integration.`);
  }
}

export const notionEnabled = Boolean(client);
