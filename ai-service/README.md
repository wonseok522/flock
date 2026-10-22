# Flock ai-service (Cognee)

A small FastAPI sidecar around **Cognee**: Flock's community trust graph. It remembers who studied together and who walked home safely together. It then writes the one-line trust reason shown on each walk-buddy match card.

It runs on the demo laptop at `localhost:8001`. **Only the local Flock worker (`bot/`) calls it. The browser never does.** Vercel can't reach localhost (see `docs/BUILD_PLAN.md` D2).

- Python **3.12** via uv (chosen over the machine default 3.13 to stay on a mainstream version for Cognee's native dependencies)
- Pinned in `requirements.txt`: `cognee==1.6.5`, `fastapi==0.161.0`, `uvicorn==0.54.0`

## Setup

```bash
cd ai-service
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r requirements.txt
# or: source .venv/bin/activate && pip install -r requirements.txt
```

## Run

```bash
cd ai-service
.venv/bin/uvicorn main:app --port 8001
```

The first start takes a few seconds while Cognee loads.

## Environment (`ai-service/.env`, never committed)

| Var | Required | What it's for |
|---|---|---|
| `LLM_API_KEY` | for real reasons | A **Google Gemini** key (free: https://aistudio.google.com/apikey). Cognee uses it to build the graph (`cognify`), embed the text and answer `/trust` searches. `EMBEDDING_API_KEY=${LLM_API_KEY}` reuses it for embeddings. |
| `LLM_PROVIDER`, `LLM_MODEL` | yes | `gemini` and `gemini/gemini-3.1-flash-lite` (the free tier's most generous limits; older models such as `gemini-2.5-flash` return 404 for new keys). |
| `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS` | yes | `gemini`, `gemini/gemini-embedding-001`, `768`. |
| `LLM_RATE_LIMIT_*`, `EMBEDDING_RATE_LIMIT_*` | recommended | Keep Cognee under the free tier (12 LLM requests/min). Without them, cognify bursts get `RateLimitError`. |
| `TRUST_TIMEOUT_S` | no | `/trust` time limit, default 25 s (the match card shows at once and fills the reason in live). |

Put keys **in `ai-service/.env`**. Cognee loads this file at import time with `override=True`, so it wins over variables exported in your shell. Cognee's local databases go in `ai-service/.cognee_system/`, `ai-service/.data_storage/` and `ai-service/.cognee_cache/`. All three are gitignored. To wipe the graph, stop the server and delete them.

## Endpoints

### `GET /health`

```bash
curl -s localhost:8001/health
# {"ok":true,"cognee_version":"1.6.5","llm_configured":false}
```

### `POST /remember`: add a fact to the graph

The call returns `{"queued": true}` straight away. A background task runs `cognee.add(..., dataset_name="flock")` and then `cognee.cognify(datasets=["flock"])`. Cognify runs one at a time, behind a lock. Texts that arrive during a run are added together as one batch, followed by **one** more cognify. A burst of 10 joins therefore causes at most two runs, not ten.

The worker tags people and sessions with ids, so two members called Amara don't get mixed up:

```bash
curl -s -X POST localhost:8001/remember -H 'content-type: application/json' \
  -d '{"text":"Amara [m:3f2a9c] studied at \"Late study\" [s:91bd02] on 22 Oct 2026."}'

curl -s -X POST localhost:8001/remember -H 'content-type: application/json' \
  -d '{"text":"Amara [m:3f2a9c] and Ben [m:77c1e0] walked home safely together from \"Late study\" [s:91bd02] towards Camden Town on 22 Oct 2026."}'
# {"queued":true}
```

### `POST /trust`: one-sentence reason for a match card

```bash
curl -s -X POST localhost:8001/trust -H 'content-type: application/json' -d '{
  "member_a": {"id": "3f2a9c11-...", "first_name": "Amara"},
  "member_b": {"id": "77c1e0aa-...", "first_name": "Ben"},
  "session_title": "Late study"
}'
# {"reason":"You both studied at \"Late study\", and Ben has walked home safely with 2 Flock members.","source":"cognee"}
```

- The service runs a Cognee `GRAPH_COMPLETION` search over the `flock` dataset. Members appear in the query as `First [m:<first 6 chars of id>]`.
- Before the reply goes out, every `[m:…]`/`[s:…]` tag, id, UUID and email is stripped and the whitespace is collapsed. Only first names are ever returned.
- Cognee answered but found no shared history → `{"reason": null, "source": "cognee"}`.
- Hard timeout of **8 s**, or any error → `{"reason": null, "source": "unavailable"}`. The error is logged.

## Without an LLM key (labelled fallback)

If `LLM_API_KEY` is empty, the server still starts:

| Endpoint | Behaviour |
|---|---|
| `/health` | `"llm_configured": false` |
| `/remember` | returns `{"queued": true}` and logs `remember skipped: LLM_API_KEY missing`. Nothing is stored. |
| `/trust` | returns `{"reason": null, "source": "unavailable"}` straight away |

The worker leaves `matches.reason` as null. The match card keeps its Supabase trust reasons and shows the label **"Cognee reason unavailable"**. This is a fallback and must be flagged in the demo. It is not a real Cognee integration.

`/trust` also returns `unavailable` until the first `/remember` has gone through `cognify`, because Cognee hasn't created its database yet.
