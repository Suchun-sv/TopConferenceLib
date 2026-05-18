"""Batch-translate paper abstracts to Chinese via OpenAI.

Mirrors translate.py (titles) but for the longer abstract field. Abstracts are
~200-400 tokens each, so we use smaller batches but higher concurrency.

Usage:
    uv run python -m crawler.translate_abstracts --venue-id iclr-2025
    uv run python -m crawler.translate_abstracts            # all venues, missing only
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
log = logging.getLogger("tcr.translate_abs")


SYSTEM_PROMPT = (
    "你是一位帮 ML / 数据库会议论文做中文摘要翻译的语言学家，目标读者是中国研究生。"
    "要求：信达雅，但术语严格保留英文（如 LLM, Transformer, MoE, RAG, RLHF, "
    "diffusion model, attention, fine-tuning, KV cache, GPU, query optimizer, "
    "B-tree, vector index 等）。常见概念用约定俗成的中文翻译（大语言模型、扩散模型、"
    "强化学习、检索增强生成、图神经网络）。保持原文段落结构，不要添加任何解释或前缀。"
    "只输出中文译文。"
)

USER_PROMPT_TEMPLATE = (
    "请为下列论文摘要分别翻译成中文。返回 JSON 对象 "
    '{{"papers": [{{"id": "...", "abstract_zh": "..."}}]}}, '
    "保持顺序与输入一致。\n\n输入：\n{papers}"
)


async def translate_batch(
    client: httpx.AsyncClient,
    api_key: str,
    model: str,
    batch: list[dict],
    max_retries: int = 3,
) -> list[dict]:
    paper_block = "\n\n".join(
        f'### id: {p["id"]}\n{p["abstract"]}' for p in batch
    )
    body = {
        "model": model,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": USER_PROMPT_TEMPLATE.format(papers=paper_block)},
        ],
        "temperature": 0.2,
    }

    for attempt in range(max_retries):
        try:
            r = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json=body,
                timeout=120,
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
    log.error("batch failed after %d retries (ids: %s)",
              max_retries, [p["id"] for p in batch])
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
    limit: Optional[int],
):
    api_key = os.environ["OPENAI_API_KEY"]

    conn = connect()
    where = "abstract is not null and length(abstract) > 50"
    if only_missing:
        where += " and abstract_zh is null"
    if venue_id:
        where += f" and venue_id = '{venue_id}'"
    sql = f"select id, abstract from papers where {where} order by id"
    if limit:
        sql += f" limit {limit}"
    with conn.cursor() as cur:
        cur.execute(sql)
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
            zh = it.get("abstract_zh")
            if not (pid and isinstance(zh, str)):
                continue
            zh = zh.replace("\x00", "").strip()
            if not zh:
                continue
            try:
                cur.execute(
                    "update papers set abstract_zh = %s, updated_at = now() where id = %s",
                    (zh, pid),
                )
            except Exception as e:
                log.warning("write failed for %s: %s", pid, e)
                conn.rollback()
    conn.commit()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--venue-id", default=None)
    parser.add_argument("--batch-size", type=int, default=5)
    parser.add_argument("--concurrency", type=int, default=8)
    parser.add_argument("--model", default=os.getenv("LLM_MODEL", "gpt-4o-mini"))
    parser.add_argument("--retranslate", action="store_true",
                        help="Re-translate papers that already have abstract_zh")
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()

    asyncio.run(run(
        venue_id=args.venue_id,
        batch_size=args.batch_size,
        concurrency=args.concurrency,
        model=args.model,
        only_missing=not args.retranslate,
        limit=args.limit,
    ))


if __name__ == "__main__":
    main()
