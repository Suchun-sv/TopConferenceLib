"""Batch-generate detailed Chinese paper retellings into papers.ai_summary_v1.

- Source PDF: streamed from local MinIO (papers.pdf_url), text via pypdf,
  body-only (references/appendix stripped), capped.
- Model: gpt-5.4-mini, locked detailed prompt, capped output.
- Keys: rotated round-robin across ~/.retell_keys (one per line). Per-key
  concurrency is bounded so total stays well under rate limits.
- Idempotent & resumable: only rows with ai_summary_v1 IS NULL are processed;
  result written back per-paper as it finishes.

Run:  uv run python -m crawler.cli retell-sweep [--per-key-concurrency 12] [--limit N]
"""
from __future__ import annotations

import io
import json
import logging
import os
import re
import threading
import time
import urllib.request
import urllib.error
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor

import psycopg

log = logging.getLogger("tcr.crawler.retell")

KEYS_FILE = os.path.expanduser("~/.retell_keys")
MODEL = "gpt-5.4-mini"
MAX_BODY = 40_000
MAX_OUT_TOK = 2800
MIN_BODY = 800
EXTRACT_PROCS = min(10, (os.cpu_count() or 4))
_RETRYABLE = {408, 409, 425, 429, 500, 502, 503, 504}

PROMPT = (
    "中文一步一步、详细地重述这篇文章解决的是什么问题，用的什么方法，并做总结。"
    "要求：用中文；分点并配小标题；尽量详尽、逐步展开，覆盖："
    "①问题背景与动机；②为什么这个问题难/现有方法的不足；③核心思路与关键创新；"
    "④方法的具体步骤与重要设计细节；⑤实验设置与主要结果；⑥结论与意义。"
    "篇幅大致1200~2000字，宁可详细不要过简；"
    "结尾不要追加任何后续建议、不要反问、不要提出可以继续帮忙之类的话。"
)


def _load_keys() -> list[str]:
    if not os.path.exists(KEYS_FILE):
        raise RuntimeError(f"keys file not found: {KEYS_FILE}")
    keys = [
        ln.strip()
        for ln in open(KEYS_FILE, encoding="utf-8")
        if ln.strip().startswith("sk-")
    ]
    if not keys:
        raise RuntimeError(f"no keys in {KEYS_FILE}")
    return keys


def _dburl() -> str:
    url = os.getenv("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL not set (cli.py loads apps/web/.env)")
    return url


def _strip_to_body(text: str) -> str:
    cut = len(text)
    tail_zone = int(len(text) * 0.40)
    for pat in (
        r"(?im)^\s*(references|bibliography)\s*$",
        r"(?im)^\s*\d*\.?\s*(references|bibliography)\b",
        r"(?im)^\s*(appendix|appendices|supplementary(\s+material)?|supplemental)\b",
    ):
        for m in re.finditer(pat, text):
            if m.start() >= tail_zone:
                cut = min(cut, m.start())
                break
    body = text[:cut].strip()
    if len(body) < 1500:  # heading not found / too aggressive -> head+tail
        if len(text) > MAX_BODY:
            head = text[: int(MAX_BODY * 0.7)]
            tail = text[-int(MAX_BODY * 0.3):]
            body = f"{head}\n\n[...]\n\n{tail}"
        else:
            body = text.strip()
    return body[:MAX_BODY]


def _extract(pdf_url: str) -> str:
    logging.getLogger("pypdf").setLevel(logging.ERROR)  # silence noisy warnings
    pdf = urllib.request.urlopen(pdf_url, timeout=90).read()
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(pdf))
    parts = []
    for i, page in enumerate(reader.pages):
        if i >= 60:
            break
        try:
            parts.append(page.extract_text() or "")
        except Exception:
            pass
    return _strip_to_body("\n".join(parts))


def _llm(key: str, meta: str, body: str) -> str:
    system = (
        "你是研究助理。下面是一篇学术论文的元数据与正文（已去除参考文献/附录）。"
        "只依据该论文内容回答。\n\n===== PAPER =====\n" + meta + "\n\n" + body
        + "\n===== END ====="
    )
    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": PROMPT},
        ],
        "max_completion_tokens": MAX_OUT_TOK,
    }
    data = json.dumps(payload).encode()
    delay = 4.0
    for attempt in range(5):
        req = urllib.request.Request(
            "https://api.openai.com/v1/chat/completions",
            data=data,
            headers={
                "content-type": "application/json",
                "authorization": f"Bearer {key}",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                j = json.loads(r.read())
            content = (
                j.get("choices", [{}])[0].get("message", {}).get("content", "")
            )
            content = content.replace("\x00", "").strip()  # PG rejects NUL
            if not content:
                raise RuntimeError("empty completion")
            return content
        except urllib.error.HTTPError as e:
            code = e.code
            if code in _RETRYABLE and attempt < 4:
                time.sleep(delay)
                delay = min(delay * 2, 120.0)
                continue
            raise RuntimeError(f"HTTP {code}: {e.read()[:200]!r}")
        except Exception as e:
            if attempt < 4:
                time.sleep(delay)
                delay = min(delay * 2, 120.0)
                continue
            raise RuntimeError(f"{type(e).__name__}: {e}")
    raise RuntimeError("exhausted retries")


_stats_lock = threading.Lock()


def run_sweep(per_key_concurrency: int = 12, limit: int | None = None) -> dict:
    keys = _load_keys()
    nk = len(keys)
    workers = per_key_concurrency * nk
    dburl = _dburl()

    sql = (
        "select id, title, venue_id, pdf_url from papers "
        "where pdf_url like 'http://localhost:9100/papers/%' "
        "and ai_summary_v1 is null and title is not null "
        "order by id"
    )
    if limit:
        sql += f" limit {int(limit)}"
    with psycopg.connect(dburl) as c, c.cursor() as cur:
        cur.execute(sql)
        rows = cur.fetchall()
    total = len(rows)
    log.info(
        "retell sweep: %d papers, %d keys x %d = %d workers, model=%s",
        total, nk, per_key_concurrency, workers, MODEL,
    )

    state = {"done": 0, "failed": 0, "i": 0}
    t_start = time.time()

    # Extraction (pypdf) is pure-Python / GIL-bound, so it runs in a process
    # pool for true parallelism; LLM+DB stay in the thread pool (IO-bound).
    extract_pool = ProcessPoolExecutor(max_workers=EXTRACT_PROCS)
    log.info("extraction: %d processes (off-GIL)", EXTRACT_PROCS)

    def work(args):
        idx, (pid, title, venue, pdf_url) = args
        key = keys[idx % nk]
        try:
            body = extract_pool.submit(_extract, pdf_url).result(timeout=180)
            if len(body) < MIN_BODY:
                raise RuntimeError(f"body too short ({len(body)} chars)")
            meta = f"id={pid} venue={venue} title={title}"
            summary = _llm(key, meta, body)
            with psycopg.connect(dburl) as c, c.cursor() as cur:
                cur.execute(
                    "update papers set ai_summary_v1=%s, ai_summary_v1_at=now() "
                    "where id=%s",
                    (summary, pid),
                )
            ok = True
            err = None
        except Exception as e:
            ok = False
            err = f"{type(e).__name__}: {e}"
        with _stats_lock:
            state["i"] += 1
            if ok:
                state["done"] += 1
            else:
                state["failed"] += 1
            i = state["i"]
            if not ok:
                log.warning("[%d/%d] FAIL %s (%s): %s", i, total, pid, venue, err)
            if i % 50 == 0 or i == total:
                el = time.time() - t_start
                rate = i / el * 60 if el else 0
                rem = (total - i) / (i / el) / 3600 if i and el else 0
                log.info(
                    "[%d/%d] done=%d failed=%d  %.1f/min  ETA %.1fh",
                    i, total, state["done"], state["failed"], rate, rem,
                )

    if total:
        try:
            with ThreadPoolExecutor(max_workers=workers) as ex:
                list(ex.map(work, enumerate(rows)))
        finally:
            extract_pool.shutdown(wait=True, cancel_futures=True)
    else:
        extract_pool.shutdown(wait=False, cancel_futures=True)

    summary = {
        "total": total,
        "done": state["done"],
        "failed": state["failed"],
        "elapsed_h": round((time.time() - t_start) / 3600, 2),
        "keys": nk,
        "per_key_concurrency": per_key_concurrency,
    }
    log.info("retell sweep finished: %s", summary)
    return summary
