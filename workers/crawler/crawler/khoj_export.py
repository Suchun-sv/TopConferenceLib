"""Export a curated paper to the Khoj watch folder.

Writes:
  ${KHOJ_EXPORT_DIR}/<venue_id>/<paper_id>.pdf   (best-effort, with retry)
  ${KHOJ_EXPORT_DIR}/<venue_id>/<paper_id>.md    (always — metadata + abstracts)

The .md sidecar guarantees Khoj can retrieve the paper even when the PDF is
missing or scanned. PDF download retries on timeout + transient HTTP codes.
"""
from __future__ import annotations

import json
import logging
import os
import random
import time
from typing import Optional

import httpx

log = logging.getLogger("tcr.crawler.khoj")

EXPORT_DIR = os.environ.get("KHOJ_EXPORT_DIR", "./data/khoj")
TCR_BASE_URL = os.environ.get("TCR_BASE_URL", "http://localhost:3002")
MAX_PDF_BYTES = 30 * 1024 * 1024
RETRY_CODES = {403, 408, 429, 500, 502, 503, 504}
_TIMEOUT = httpx.Timeout(30.0, read=60.0)


class PermanentFetchError(Exception):
    pass


def _fetch_pdf_with_retry(url: str, attempts: int = 3) -> bytes:
    delay = 2.0
    last: Optional[str] = None
    for i in range(attempts):
        try:
            with httpx.Client(
                headers={"User-Agent": "tcr-khoj/0.1"},
                timeout=_TIMEOUT,
                follow_redirects=True,
            ) as c:
                r = c.get(url)
            if r.status_code == 200:
                data = r.content
                if len(data) > MAX_PDF_BYTES:
                    raise PermanentFetchError(f"pdf too large: {len(data)} bytes")
                return data
            if r.status_code in RETRY_CODES:
                last = f"HTTP {r.status_code}"
                log.warning("  pdf %s (attempt %d/%d), backing off %.0fs", last, i + 1, attempts, delay)
            else:
                # 404 and other 4xx → permanent
                raise PermanentFetchError(f"HTTP {r.status_code}")
        except (httpx.TimeoutException, httpx.TransportError) as e:
            last = f"{type(e).__name__}: {e}"
            log.warning("  pdf timeout/transport (attempt %d/%d): %s", i + 1, attempts, last)
        if i < attempts - 1:
            time.sleep(delay + random.uniform(0, 1.0))
            delay *= 2
    raise PermanentFetchError(f"exhausted retries: {last}")


def _slug(s: str) -> str:
    return "".join(c if c.isalnum() or c in "-_." else "-" for c in s)[:80]


def _front_matter(p: dict) -> str:
    def esc(v: str) -> str:
        return (v or "").replace("\\", "\\\\").replace('"', '\\"').replace("\n", " ")

    authors = p.get("authors") or []
    if isinstance(authors, str):
        try:
            authors = json.loads(authors)
        except Exception:
            authors = [authors]
    lines = [
        "---",
        f'title: "{esc(p["title"])}"',
        f'title_zh: "{esc(p.get("title_zh") or "")}"',
        f'authors: [{", ".join(json.dumps(a) for a in authors)}]',
        f'venue: "{esc(p["venue_id"])}"',
        f'decision: "{esc(p.get("decision") or "")}"',
        f'pdf_url: "{esc(p.get("pdf_url") or "")}"',
        f'openreview_url: "{esc(p.get("openreview_url") or "")}"',
        f'tcr_url: "{TCR_BASE_URL}/p/{p["id"]}"',
        "---",
    ]
    return "\n".join(lines)


def _markdown(p: dict) -> str:
    parts = [_front_matter(p), "", f'# {p["title"]}']
    if p.get("title_zh"):
        parts.append(f'\n（中文）{p["title_zh"]}')
    if p.get("abstract"):
        parts += ["", "## Abstract", p["abstract"]]
    if p.get("abstract_zh"):
        parts += ["", "## 摘要（中文）", p["abstract_zh"]]
    parts += ["", f'[View on TCR]({TCR_BASE_URL}/p/{p["id"]})']
    return "\n".join(parts) + "\n"


def export_paper(conn, paper_id: str) -> dict:
    with conn.cursor() as cur:
        cur.execute(
            """
            select id, title, title_zh, authors, abstract, abstract_zh,
                   decision, venue_id, pdf_url, openreview_url
              from papers where id = %s
            """,
            (paper_id,),
        )
        p = cur.fetchone()
    if not p:
        _set_status(conn, paper_id, "failed", None, "paper not found")
        raise ValueError(f"paper {paper_id} not found")

    venue_dir = os.path.join(EXPORT_DIR, _slug(p["venue_id"]))
    os.makedirs(venue_dir, exist_ok=True)
    base = os.path.join(venue_dir, _slug(p["id"]))
    rel_path = os.path.join(_slug(p["venue_id"]), _slug(p["id"]))

    # Always write the markdown sidecar.
    with open(base + ".md", "w", encoding="utf-8") as f:
        f.write(_markdown(p))

    pdf_ok = False
    pdf_err = None
    if p.get("pdf_url"):
        try:
            data = _fetch_pdf_with_retry(p["pdf_url"])
            with open(base + ".pdf", "wb") as f:
                f.write(data)
            pdf_ok = True
        except PermanentFetchError as e:
            pdf_err = str(e)
            log.warning("  pdf export failed for %s: %s", paper_id, pdf_err)
    else:
        pdf_err = "no pdf_url"

    # md always written ⇒ status done; record pdf issue in error for visibility.
    _set_status(conn, paper_id, "done", rel_path, None if pdf_ok else f"md only ({pdf_err})")
    return {"paperId": paper_id, "pdf": pdf_ok}


def _set_status(conn, paper_id: str, status: str, rel_path, error) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into khoj_exports (paper_id, status, rel_path, error, exported_at)
            values (%s, %s, %s, %s, now())
            on conflict (paper_id) do update set
              status = excluded.status,
              rel_path = excluded.rel_path,
              error = excluded.error,
              exported_at = now()
            """,
            (paper_id, status, rel_path, error),
        )
    conn.commit()
