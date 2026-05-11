"""LLM-driven summary + oneliner for papers."""
from __future__ import annotations

import logging
import os
from typing import Any

log = logging.getLogger("tcr.crawler.summarize")


def summarize_papers(conn, paper_ids: list[str], style: str = "both") -> dict[str, Any]:
    if not paper_ids:
        return {"updated": 0}
    from litellm import completion  # local import; heavy

    model = os.getenv("LLM_MODEL", "gpt-4o-mini")
    updated = 0
    for pid in paper_ids:
        with conn.cursor() as cur:
            cur.execute("select title, abstract from papers where id = %s", (pid,))
            row = cur.fetchone()
            if not row:
                continue
            title, abstract = row["title"], row["abstract"] or ""

        oneliner = None
        summary = None
        if style in ("oneliner", "both"):
            oneliner = _ask(completion, model, _oneliner_prompt(title, abstract))
        if style in ("summary", "both"):
            summary = _ask(completion, model, _summary_prompt(title, abstract))

        with conn.cursor() as cur:
            sets, args = [], []
            if oneliner is not None:
                sets.append("ai_oneliner = %s")
                args.append(oneliner)
            if summary is not None:
                sets.append("ai_summary = %s")
                args.append(summary)
            if sets:
                sets.append("updated_at = now()")
                args.append(pid)
                cur.execute(f"update papers set {', '.join(sets)} where id = %s", args)
        conn.commit()
        updated += 1
    return {"updated": updated}


def _ask(completion, model: str, prompt: str) -> str:
    r = completion(
        model=model,
        messages=[
            {"role": "system", "content": "You are an expert summarizer of ML/database research papers."},
            {"role": "user", "content": prompt},
        ],
    )
    return r.choices[0].message.content.strip()


def _oneliner_prompt(title: str, abstract: str) -> str:
    return (
        f"Title: {title}\n\nAbstract:\n{abstract}\n\n"
        "Write a single-sentence one-liner (max 25 words) that captures what is new about this paper."
    )


def _summary_prompt(title: str, abstract: str) -> str:
    return (
        f"Title: {title}\n\nAbstract:\n{abstract}\n\n"
        "Write a 4-bullet summary covering: (1) problem, (2) key idea, (3) result, (4) limitation."
    )
