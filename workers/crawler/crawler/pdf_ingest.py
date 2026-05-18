"""Slowly mirror every paper's PDF into the local MinIO bucket and rewrite
papers.pdf_url to the MinIO address.

Design goals:
- Idempotent & resumable: papers whose pdf_url already points at MinIO are
  skipped; if the object already exists we just fix the DB row.
- Gentle on source sites: a polite fixed delay between papers plus
  exponential backoff with jitter on transient failures.
- Never abort the whole run on one bad paper — log and move on.

Run via:  uv run python -m crawler.cli ingest-pdfs [--limit N] [--delay 2.0]
"""
from __future__ import annotations

import io
import logging
import os
import random
import re
import time
from typing import Optional
from urllib.parse import urlparse

import httpx
from minio import Minio

from crawler.store import connect

log = logging.getLogger("tcr.crawler.pdf_ingest")

_KEY_SAFE = re.compile(r"[^A-Za-z0-9._-]+")
_MAX_PDF_BYTES = 80 * 1024 * 1024  # skip pathologically huge files
_HTTP_TIMEOUT = httpx.Timeout(30.0, read=120.0)
_RETRYABLE = {408, 425, 429, 500, 502, 503, 504}
# Hosts that paywall PDFs — never downloadable, don't even try (saves ~3min each).
_SKIP_HOSTS = {"dl.acm.org", "ieeexplore.ieee.org", "link.springer.com"}


def _env(name: str, required: bool = True, default: Optional[str] = None) -> str:
    v = os.getenv(name, default)
    if required and not v:
        raise RuntimeError(f"{name} not set (put it in apps/web/.env and export it)")
    return v or ""


def _minio_client() -> tuple[Minio, str, str]:
    endpoint = _env("MINIO_ENDPOINT")  # e.g. http://localhost:9100
    bucket = _env("MINIO_BUCKET", default="papers")
    public_base = _env("MINIO_PUBLIC_BASE", default=f"{endpoint}/{bucket}").rstrip("/")
    u = urlparse(endpoint)
    client = Minio(
        u.netloc,
        access_key=_env("MINIO_ACCESS_KEY"),
        secret_key=_env("MINIO_SECRET_KEY"),
        secure=(u.scheme == "https"),
    )
    return client, bucket, public_base


def _object_key(paper_id: str) -> str:
    safe = _KEY_SAFE.sub("_", paper_id).strip("_") or "paper"
    return f"{safe}.pdf"


def _download(url: str) -> Optional[bytes]:
    """Download a PDF with exponential backoff + jitter. Returns bytes or None."""
    delay = 2.0
    for attempt in range(6):
        try:
            with httpx.Client(
                headers={"User-Agent": "tcr-crawler/0.1"},
                timeout=_HTTP_TIMEOUT,
                follow_redirects=True,
            ) as c:
                with c.stream("GET", url) as r:
                    if r.status_code in _RETRYABLE:
                        raise httpx.HTTPStatusError(
                            f"retryable {r.status_code}", request=r.request, response=r
                        )
                    if r.status_code >= 400:
                        # Permanent (403 paywall, 404, 410, 451…). No point retrying.
                        log.warning("  permanent HTTP %d, skipping: %s", r.status_code, url)
                        return None
                    r.raise_for_status()
                    clen = int(r.headers.get("content-length") or 0)
                    if clen and clen > _MAX_PDF_BYTES:
                        log.warning("  skip: content-length %d > cap", clen)
                        return None
                    buf = io.BytesIO()
                    for chunk in r.iter_bytes(256 * 1024):
                        buf.write(chunk)
                        if buf.tell() > _MAX_PDF_BYTES:
                            log.warning("  skip: stream exceeded cap")
                            return None
                    data = buf.getvalue()
            if len(data) < 1000 or data[:5] not in (b"%PDF-", b"%PDF\r", b"%PDF\n"):
                # Not a real PDF (HTML error/login page). Treat as a soft failure.
                if data[:5] != b"%PDF-":
                    log.warning("  not a PDF (first bytes %r)", data[:8])
                    return None
            return data
        except Exception as e:
            sleep = delay + random.uniform(0, delay * 0.5)
            log.warning(
                "  download attempt %d failed (%s); backing off %.1fs",
                attempt + 1, type(e).__name__, sleep,
            )
            time.sleep(sleep)
            delay = min(delay * 2, 120.0)
    log.error("  giving up after retries: %s", url)
    return None


def _ensure_bucket(client: Minio, bucket: str) -> None:
    if not client.bucket_exists(bucket):
        client.make_bucket(bucket)


def ingest_pdfs(
    limit: Optional[int] = None,
    delay: float = 2.0,
    venue: Optional[str] = None,
) -> dict:
    client, bucket, public_base = _minio_client()
    _ensure_bucket(client, bucket)

    conn = connect()
    where = ["pdf_url is not null", "pdf_url <> ''", "pdf_url not like %s"]
    params: list = [f"{public_base}/%"]
    if venue:
        where.append("venue_id = %s")
        params.append(venue)
    sql = (
        "select id, pdf_url, venue_id from papers where "
        + " and ".join(where)
        + " order by venue_id desc, id"
    )
    if limit:
        sql += f" limit {int(limit)}"

    with conn.cursor() as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()
    total = len(rows)
    log.info("PDF ingest: %d papers to process (delay=%.1fs)", total, delay)

    done = existing = failed = skipped = 0
    for i, row in enumerate(rows, 1):
        pid, src_url, ven = row["id"], row["pdf_url"], row["venue_id"]
        key = _object_key(pid)
        url = f"{public_base}/{key}"

        host = urlparse(src_url).netloc.lower()
        if any(host == h or host.endswith("." + h) for h in _SKIP_HOSTS):
            skipped += 1
            if skipped % 50 == 0 or i == total:
                log.info("[%d/%d] skipped=%d (paywalled hosts) last_host=%s", i, total, skipped, host)
            continue

        try:
            already = False
            try:
                client.stat_object(bucket, key)
                already = True
            except Exception:
                already = False

            if already:
                existing += 1
            else:
                data = _download(src_url)
                if data is None:
                    failed += 1
                    log.info("[%d/%d] FAIL %s (%s)", i, total, pid, ven)
                    time.sleep(delay)
                    continue
                client.put_object(
                    bucket, key, io.BytesIO(data), length=len(data),
                    content_type="application/pdf",
                )
                done += 1

            with conn.cursor() as cur:
                cur.execute(
                    "update papers set pdf_url = %s, updated_at = now() where id = %s",
                    (url, pid),
                )
            conn.commit()
            if i % 25 == 0 or i == total:
                log.info(
                    "[%d/%d] uploaded=%d existing=%d failed=%d  last=%s",
                    i, total, done, existing, failed, pid,
                )
        except Exception:
            conn.rollback()
            failed += 1
            log.exception("[%d/%d] error on %s", i, total, pid)
        # Go slowly regardless of success to be gentle on source sites.
        time.sleep(delay)

    conn.close()
    summary = {
        "total": total,
        "uploaded": done,
        "already_present": existing,
        "failed": failed,
        "skipped": skipped,
    }
    log.info("PDF ingest finished: %s", summary)
    return summary
