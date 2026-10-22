import { connection } from "next/server";
import { Client, isFullBlock, type BlockObjectResponse, type RichTextItemResponse } from "@notionhq/client";

// University security and welfare contacts, read live from the community's
// Safety Rules page in Notion (written by Grok Bot). Best effort: the blocks
// under a heading containing "University contacts" become {name, detail} lines.
// We never invent phone numbers: if Notion can't be read, the UI tells the
// student to ask their society.

type Contact = { name: string; detail: string };
type ContactsResponse = { source: "notion" | "fallback"; contacts: Contact[]; reason?: string };

const TIMEOUT_MS = 5000;
const CACHE_MS = 10 * 60 * 1000;
const FALLBACK_CACHE_MS = 60 * 1000;
const HEADING_MATCH = /university contacts/i;

let cache: { at: number; ttl: number; value: ContactsResponse } | null = null;

function text(rich: RichTextItemResponse[]): string {
  return rich.map((r) => r.plain_text).join("").replace(/\s+/g, " ").trim();
}

function headingInfo(b: BlockObjectResponse): { level: number; text: string; toggle: boolean } | null {
  if (b.type === "heading_1") return { level: 1, text: text(b.heading_1.rich_text), toggle: b.heading_1.is_toggleable };
  if (b.type === "heading_2") return { level: 2, text: text(b.heading_2.rich_text), toggle: b.heading_2.is_toggleable };
  if (b.type === "heading_3") return { level: 3, text: text(b.heading_3.rich_text), toggle: b.heading_3.is_toggleable };
  return null;
}

function lineOf(b: BlockObjectResponse): string | null {
  switch (b.type) {
    case "bulleted_list_item":
      return text(b.bulleted_list_item.rich_text);
    case "numbered_list_item":
      return text(b.numbered_list_item.rich_text);
    case "paragraph":
      return text(b.paragraph.rich_text);
    case "to_do":
      return text(b.to_do.rich_text);
    case "callout":
      return text(b.callout.rich_text);
    case "quote":
      return text(b.quote.rich_text);
    case "toggle":
      return text(b.toggle.rich_text);
    default:
      return null;
  }
}

/** "UCL Security — 020 …" → {name: "UCL Security", detail: "020 …"}. */
function toContact(line: string): Contact | null {
  const clean = line.trim();
  if (!clean) return null;
  const m = clean.match(/^(.+?)\s*(?:[—–:]|\s-\s)\s*(.+)$/);
  if (m) return { name: m[1].trim(), detail: m[2].trim() };
  return { name: clean, detail: "" };
}

async function listChildren(notion: Client, blockId: string): Promise<BlockObjectResponse[]> {
  const out: BlockObjectResponse[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 5; page++) {
    const res = await notion.blocks.children.list({ block_id: blockId, start_cursor: cursor, page_size: 100 });
    for (const r of res.results) if (isFullBlock(r)) out.push(r);
    if (!res.has_more || !res.next_cursor) break;
    cursor = res.next_cursor;
  }
  return out;
}

async function contactsFromBlocks(notion: Client, blocks: BlockObjectResponse[]): Promise<Contact[]> {
  const contacts: Contact[] = [];
  for (const b of blocks) {
    if (b.type === "table" && b.has_children) {
      const rows = await listChildren(notion, b.id);
      rows.forEach((row, i) => {
        if (row.type !== "table_row") return;
        const cells = row.table_row.cells.map(text).filter(Boolean);
        if (i === 0 && b.table.has_column_header) return;
        if (cells.length) contacts.push({ name: cells[0], detail: cells.slice(1).join(" · ") });
      });
      continue;
    }
    const line = lineOf(b);
    const c = line ? toContact(line) : null;
    if (c) contacts.push(c);
    // Nested bullets / toggle contents: one level deep is enough for a contacts list.
    if (b.has_children && (b.type === "bulleted_list_item" || b.type === "toggle" || b.type === "numbered_list_item")) {
      for (const child of await listChildren(notion, b.id)) {
        const l = lineOf(child);
        const cc = l ? toContact(l) : null;
        if (cc) contacts.push(cc);
      }
    }
  }
  return contacts.slice(0, 30);
}

async function readNotion(token: string, pageId: string): Promise<Contact[]> {
  const notion = new Client({ auth: token, timeoutMs: TIMEOUT_MS, retry: false });
  const blocks = await listChildren(notion, pageId);
  const start = blocks.findIndex((b) => HEADING_MATCH.test(headingInfo(b)?.text ?? ""));
  if (start === -1) return [];
  const heading = blocks[start];
  const info = headingInfo(heading)!;
  if (info.toggle && heading.has_children) {
    return contactsFromBlocks(notion, await listChildren(notion, heading.id));
  }
  const section: BlockObjectResponse[] = [];
  for (const b of blocks.slice(start + 1)) {
    const h = headingInfo(b);
    if (h && h.level <= info.level) break;
    if (b.type === "divider") break;
    section.push(b);
  }
  return contactsFromBlocks(notion, section);
}

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("Notion timed out")), ms))]);
}

export async function GET() {
  await connection();
  if (cache && Date.now() - cache.at < cache.ttl) return Response.json(cache.value);

  const token = process.env.NOTION_TOKEN;
  const pageId = process.env.NOTION_RULES_PAGE_ID;
  let value: ContactsResponse;
  if (!token || !pageId) {
    console.warn("[api/contacts] NOTION_TOKEN or NOTION_RULES_PAGE_ID not set: serving fallback");
    value = { source: "fallback", contacts: [], reason: "Notion is not configured" };
  } else {
    try {
      // Whole read (including pagination) is capped, not just each request.
      const contacts = await withDeadline(readNotion(token, pageId), TIMEOUT_MS + 1000);
      value = contacts.length
        ? { source: "notion", contacts }
        : { source: "fallback", contacts: [], reason: "No 'University contacts' section on the Safety Rules page yet" };
    } catch (e) {
      console.warn("[api/contacts] Notion read failed:", e instanceof Error ? e.message : e);
      value = { source: "fallback", contacts: [], reason: "Couldn't reach Notion" };
    }
  }
  cache = { at: Date.now(), ttl: value.source === "notion" ? CACHE_MS : FALLBACK_CACHE_MS, value };
  return Response.json(value);
}
