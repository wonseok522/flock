// Cognee runs locally (ai-service/, FastAPI). Endpoints:
//   POST /remember {text}                                   -> 2xx (cognify runs in the background)
//   POST /trust {member_a:{id,first_name}, member_b:{id,first_name}, session_title}
//                                                           -> {reason, source}
import { config } from './config.js';

const TIMEOUT_MS = 30_000; // > ai-service TRUST_TIMEOUT_S; the match card shows instantly and fills the reason in live

async function post(path, body) {
  const res = await fetch(`${config.cogneeUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Cognee ${path} HTTP ${res.status}`);
  const text = await res.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return {}; }
}

/** Remove internal tags like "[m:1a2b3c]" and any uuid; one short sentence. */
export function cleanReason(reason) {
  if (typeof reason !== 'string') return null;
  const out = reason
    .replace(/\s*\[(?:m|s):[0-9a-fA-F-]{1,36}\]/g, '')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!out) return null;
  return out.length > 300 ? `${out.slice(0, 297)}...` : out;
}

export const cognee = {
  get enabled() { return Boolean(config.cogneeUrl); },
  remember: (text) => post('/remember', { text }),
  trust: (body) => post('/trust', body),
};

/** "[m:1a2b3c]" tag used in remembered text so Cognee can tell two Amaras apart. */
export const tag = (kind, id) => `[${kind}:${String(id).slice(0, 6)}]`;
