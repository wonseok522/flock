"""Flock ai-service: a small FastAPI sidecar around Cognee (the community trust graph).

Called only by the local Flock worker (bot/), never by the browser.

  GET  /health    -> {ok, cognee_version, llm_configured}
  POST /remember  -> {queued: true}; cognee.add + cognify run in the background
  POST /trust     -> {reason, source: "cognee" | "unavailable"}
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
from pathlib import Path
from typing import Any, Literal

# --- Environment, set before importing cognee ---------------------------------
# Cognee resolves its .env once at import time. Point it at ai-service/.env
# explicitly so the service behaves the same from any working directory, and keep
# Cognee's local databases inside ai-service/ (gitignored) instead of site-packages.
HERE = Path(__file__).resolve().parent
_ENV_FILE = HERE / ".env"
if _ENV_FILE.is_file():
    os.environ.setdefault("COGNEE_ENV_FILE", str(_ENV_FILE))
os.environ.setdefault("SYSTEM_ROOT_DIRECTORY", str(HERE / ".cognee_system"))
os.environ.setdefault("DATA_ROOT_DIRECTORY", str(HERE / ".data_storage"))
os.environ.setdefault("CACHE_ROOT_DIRECTORY", str(HERE / ".cognee_cache"))

import cognee  # noqa: E402  (must come after the env setup above)
from cognee import SearchType  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

cognee.config.system_root_directory(os.environ["SYSTEM_ROOT_DIRECTORY"])
cognee.config.data_root_directory(os.environ["DATA_ROOT_DIRECTORY"])

log = logging.getLogger("flock.ai")
if not log.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(asctime)s [flock.ai] %(levelname)s %(message)s"))
    log.addHandler(_handler)
log.setLevel(logging.INFO)
log.propagate = False

DATASET = "flock"
TRUST_TIMEOUT_S = float(os.environ.get("TRUST_TIMEOUT_S", "25"))  # free-tier Gemini can be slow; the card updates live
MAX_REASON_CHARS = 280


def llm_configured() -> bool:
    return bool(os.environ.get("LLM_API_KEY", "").strip())


app = FastAPI(title="Flock ai-service (Cognee)", version="1.0.0")


# --- Models -------------------------------------------------------------------
class RememberIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class Member(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    first_name: str = Field(min_length=1, max_length=40)


class TrustIn(BaseModel):
    member_a: Member
    member_b: Member
    session_title: str | None = Field(default=None, max_length=200)


class TrustOut(BaseModel):
    reason: str | None
    source: Literal["cognee", "unavailable"]


UNAVAILABLE = TrustOut(reason=None, source="unavailable")


# --- Background remember queue -------------------------------------------------
# One worker task at a time, guarded by a lock. Texts that arrive while a
# cognify run is in progress set `_dirty`; the worker then adds them in one
# batch and runs cognify exactly once more. A burst of 10 joins => at most two
# cognify runs, never ten in parallel.
_pending: list[str] = []
_dirty = False
_cognify_lock = asyncio.Lock()
_worker: asyncio.Task[None] | None = None


async def _remember_worker() -> None:
    global _dirty
    async with _cognify_lock:
        while _dirty:
            _dirty = False
            batch = list(_pending)
            _pending.clear()
            try:
                if batch:
                    await cognee.add(batch, dataset_name=DATASET)
                log.info("cognify start (%d new text(s))", len(batch))
                await cognee.cognify(datasets=[DATASET])
                log.info("cognify done")
            except Exception:
                log.exception("remember failed for %d text(s)", len(batch))


def _enqueue(text: str) -> None:
    global _dirty, _worker
    if not llm_configured():
        log.warning("remember skipped: LLM_API_KEY missing")
        return
    _pending.append(text)
    _dirty = True
    if _worker is None or _worker.done():
        _worker = asyncio.create_task(_remember_worker())


# --- Trust reason ----------------------------------------------------------------
_TAG_RE = re.compile(r"\[\s*[ms]\s*:[^\]]*\]", re.IGNORECASE)
_BARE_TAG_RE = re.compile(r"\b[ms]:[0-9a-f-]{4,}\b", re.IGNORECASE)
_EMAIL_RE = re.compile(r"\S+@\S+")
_UUID_RE = re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.I)

_SYSTEM_PROMPT = (
    "You write the trust line on a walk-buddy match card in Flock, an app that "
    "helps London university students get home safely after studying late.\n"
    "Using ONLY facts in the provided context, write ONE short, warm, factual "
    "sentence (max 30 words) about what the two students share: study sessions "
    "they both attended, and safe walks home with Flock members.\n"
    "Rules: first names only; never mention ids, tags in square brackets, emails, "
    "surnames, phone numbers or addresses; never invent or guess facts; no "
    "preamble, no quotes.\n"
    'If the context contains no relevant facts about them, reply with exactly: NONE'
)


def _label(m: Member) -> str:
    return f"{m.first_name.strip()} [m:{m.id.strip()[:6]}]"


def _build_query(body: TrustIn) -> str:
    a, b = _label(body.member_a), _label(body.member_b)
    q = (
        f"What do {a} and {b} have in common? List the study sessions they both "
        f"studied at, whether they walked home safely together, and how many safe "
        f"walks home with Flock members {b} has completed."
    )
    if body.session_title:
        q += f' They were matched after "{body.session_title}".'
    q += (
        f" Answer in one sentence addressed to both of them, for example: "
        f'"You both studied at <session>, and {body.member_b.first_name.strip()} has '
        f'walked home safely with 2 Flock members."'
    )
    return q


def _first_text(value: Any) -> str | None:
    """Pull the first answer string out of Cognee's (version-dependent) result shape."""
    if value is None:
        return None
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        for key in ("search_result", "result", "answer", "text"):
            if key in value:
                return _first_text(value[key])
        return None
    if isinstance(value, (list, tuple)):
        for item in value:
            text = _first_text(item)
            if text and text.strip():
                return text
        return None
    if hasattr(value, "search_result"):
        return _first_text(value.search_result)
    return None


def clean_reason(raw: str | None) -> str | None:
    if not raw:
        return None
    text = _TAG_RE.sub("", raw)
    text = _BARE_TAG_RE.sub("", text)
    text = _EMAIL_RE.sub("", text)
    text = _UUID_RE.sub("", text)
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\s+([,.;:!?])", r"\1", text)  # "Amara , Ben" -> "Amara, Ben"
    text = text.strip(" \"'“”‘’")
    if not text or text.upper().rstrip(".") == "NONE":
        return None
    if len(text) > MAX_REASON_CHARS:
        text = text[: MAX_REASON_CHARS - 1].rsplit(" ", 1)[0] + "…"
    return text


async def _search_reason(body: TrustIn) -> str | None:
    results = await cognee.search(
        query_text=_build_query(body),
        query_type=SearchType.GRAPH_COMPLETION,
        datasets=[DATASET],
        system_prompt=_SYSTEM_PROMPT,
        top_k=10,
    )
    return clean_reason(_first_text(results))


# --- Routes ------------------------------------------------------------------------
@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "cognee_version": str(cognee.__version__),
        "llm_configured": llm_configured(),
    }


@app.post("/remember")
async def remember(body: RememberIn) -> dict[str, bool]:
    _enqueue(body.text.strip())
    return {"queued": True}


@app.post("/trust", response_model=TrustOut)
async def trust(body: TrustIn) -> TrustOut:
    if not llm_configured():
        log.warning("trust unavailable: LLM_API_KEY missing")
        return UNAVAILABLE
    try:
        reason = await asyncio.wait_for(_search_reason(body), timeout=TRUST_TIMEOUT_S)
    except asyncio.TimeoutError:
        log.warning("trust unavailable: Cognee search exceeded %.0fs", TRUST_TIMEOUT_S)
        return UNAVAILABLE
    except Exception:
        log.exception("trust unavailable: Cognee search failed")
        return UNAVAILABLE
    return TrustOut(reason=reason, source="cognee")
