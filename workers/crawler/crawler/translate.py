"""Batch-translate paper titles to Chinese + score interestingness via OpenAI.

Uses a single chat-completion per batch of N titles, asks for a JSON array of
`{id, title_zh, interest_score}`. Parallelism keeps the wall-clock low; ICLR
2025's 3703 papers finish in ~3-5 minutes.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
from typing import Optional

import httpx
from dotenv import load_dotenv

from crawler.store import connect

load_dotenv()
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(message)s",
)
log = logging.getLogger("tcr.translate")


SYSTEM_PROMPT = (
    "You are translating ML/database conference paper titles into idiomatic, "
    "concise Mandarin Chinese for researchers. Keep proper nouns (e.g. LLaMA, "
    "GPT-4, MoE, RAG, RLHF, Transformer) in English. Use established Chinese "
    "translations for common terms (扩散模型, 大语言模型, 强化学习, 检索增强生成). "
    "Do NOT translate acronyms. Do NOT add quotes. Output Chinese title only, no English."
)

USER_PROMPT_TEMPLATE = (
    "For each paper below, return a JSON array of "
    '{{"id": "...", "title_zh": "...", "interest_score": 1-5}}. '
    "interest_score: how novel/interesting the title sounds to a researcher: "
    "1=routine, 3=solid contribution, 5=looks groundbreaking. "
    "Output ONLY the JSON array, no prose.\n\n"
    "Papers:\n{papers}"
)


async def translate_batch(
    client: httpx.AsyncClient,
    api_key: str,
    model: str,
    batch: list[dict],
    max_retries: int = 3,
) -> list[dict]:
    """Send one batch to OpenAI, return parsed results."""
    paper_block = "\n".join(f'- {{"id":"{p["id"]}", "title":"{p["title"]}"}}' for p in batch)
    body = {
        "model": model,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": USER_PROMPT_TEMPLATE.format(papers=paper_block)
             + '\n\nReturn an object like {"papers": [...]} where the array follows the spec above.'},
        ],
        "temperature": 0.2,
    }

    for attempt in range(max_retries):
        try:
            r = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json=body,
                timeout=60,
            )
            r.raise_for_status()
            content = r.json()["choices"][0]["message"]["content"]
            obj = json.loads(content)
            items = obj.get("papers") if isinstance(obj, dict) else obj
            if not isinstance(items, list):
                raise ValueError(f"expected list, got {type(items).__name__}")
            return items
        except (httpx.HTTPError, json.JSONDecodeError, ValueError, KeyError) as e:
            wait = 2 ** attempt
            log.warning("batch retry %d/%d after %ss: %s", attempt + 1, max_retries, wait, e)
            await asyncio.sleep(wait)
    log.error("batch failed after %d retries", max_retries)
    return []


def chunks(lst, n):
    for i in range(0, len(lst), n):
        yield lst[i : i + n]


async def run(
    venue_id: Optional[str],
    batch_size: int,
    concurrency: int,
    model: str,
    only_missing: bool,
):
    api_key = os.environ["OPENAI_API_KEY"]

    conn = connect()
    where = "title_zh is null" if only_missing else "true"
    if venue_id:
        where += f" and venue_id = '{venue_id}'"
    with conn.cursor() as cur:
        cur.execute(f"select id, title from papers where {where} order by id")
        rows = [dict(r) for r in cur.fetchall()]
    log.info("Found %d papers to translate (model=%s, batch=%d, conc=%d)",
             len(rows), model, batch_size, concurrency)
    if not rows:
        conn.close()
        return

    batches = list(chunks(rows, batch_size))
    sem = asyncio.Semaphore(concurrency)
    done = 0
    failed = 0
    lock = asyncio.Lock()

    async with httpx.AsyncClient() as client:
        async def worker(batch):
            nonlocal done, failed
            async with sem:
                items = await translate_batch(client, api_key, model, batch)
            async with lock:
                if not items:
                    failed += len(batch)
                else:
                    _write_results(conn, items)
                    done += len(items)
                log.info("progress: %d done, %d failed / %d total",
                         done, failed, len(rows))

        await asyncio.gather(*(worker(b) for b in batches))

    log.info("Final: %d translated, %d failed", done, failed)
    conn.close()


def _write_results(conn, items: list[dict]) -> None:
    with conn.cursor() as cur:
        for it in items:
            pid = it.get("id")
            zh = it.get("title_zh")
            score = it.get("interest_score")
            if not pid:
                continue
            if isinstance(zh, str):
                zh = zh.replace("\x00", "").strip() or None
            try:
                score = float(score) if score is not None else None
            except (TypeError, ValueError):
                score = None
            try:
                cur.execute(
                    "update papers set title_zh = %s, interest_score = %s, updated_at = now() where id = %s",
                    (zh, score, pid),
                )
            except Exception as e:
                log.warning("write failed for %s: %s", pid, e)
                conn.rollback()
    conn.commit()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--venue-id", default=None)
    parser.add_argument("--batch-size", type=int, default=20)
    parser.add_argument("--concurrency", type=int, default=5)
    parser.add_argument("--model", default=os.getenv("LLM_MODEL", "gpt-4o"))
    parser.add_argument("--retranslate", action="store_true",
                        help="Re-translate papers that already have title_zh")
    args = parser.parse_args()

    asyncio.run(run(
        venue_id=args.venue_id,
        batch_size=args.batch_size,
        concurrency=args.concurrency,
        model=args.model,
        only_missing=not args.retranslate,
    ))


if __name__ == "__main__":
    main()
