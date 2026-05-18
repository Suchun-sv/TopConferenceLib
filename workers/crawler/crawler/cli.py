"""CLI: tcr-crawl <conference> <year>.

Examples:
    uv run python -m crawler.cli crawl ICLR 2025
    uv run python -m crawler.cli crawl NeurIPS 2024 --max-papers 500
    uv run python -m crawler.cli worker          # process queued jobs
"""
from __future__ import annotations

import logging
import os
import time
from typing import Optional

import typer
from dotenv import load_dotenv

from crawler.openreview_source import fetch_venue
from crawler.pvldb_source import fetch_pvldb
from crawler.sigmod_source import fetch_sigmod
from crawler.store import (
    connect,
    process_one_job,
    upsert_papers,
    upsert_venue,
)

load_dotenv()
# Creds (DATABASE_URL, MINIO_*) live in the TCL web .env; load it too without
# overriding anything already set in the environment.
_TCL_WEB_ENV = os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "apps", "web", ".env"
)
if os.path.exists(_TCL_WEB_ENV):
    load_dotenv(_TCL_WEB_ENV, override=False)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
)
log = logging.getLogger("tcr.crawler")

app = typer.Typer(no_args_is_help=True)

OPENREVIEW_VENUE_ID = {
    "ICLR": "ICLR.cc/{year}/Conference",
    "NeurIPS": "NeurIPS.cc/{year}/Conference",
    "ICML": "ICML.cc/{year}/Conference",
}
DBLP_SOURCE = {"SIGMOD", "VLDB"}


def _normalize_conference(name: str) -> str:
    n = name.upper().replace("NEURIPS", "NeurIPS")
    if n in OPENREVIEW_VENUE_ID or n in DBLP_SOURCE:
        return n
    raise typer.BadParameter(f"Unknown conference: {name}")


@app.command()
def crawl(
    conference: str,
    year: int,
    max_papers: Optional[int] = typer.Option(None),
    fetch_reviews: bool = typer.Option(False, help="Also pull per-paper reviews; slow & needs OpenReview login on most venues."),
):
    """Ingest one conference-year. Routes to OpenReview or DBLP+S2 by venue."""
    conference = _normalize_conference(conference)
    venue_id = f"{conference.lower()}-{year}"

    conn = connect()
    try:
        if conference in OPENREVIEW_VENUE_ID:
            openreview_id = OPENREVIEW_VENUE_ID[conference].format(year=year)
            log.info("Crawling %s (%s)...", venue_id, openreview_id)
            upsert_venue(conn, id=venue_id, conference=conference, year=year, openreview_id=openreview_id)
            papers = fetch_venue(openreview_id, max_papers=max_papers, fetch_reviews=fetch_reviews)
        elif conference == "SIGMOD":
            log.info("Crawling %s via DBLP+S2...", venue_id)
            # No OpenReview id; reuse the column to store the DBLP source key.
            upsert_venue(conn, id=venue_id, conference=conference, year=year, openreview_id=f"dblp:journals/pacmmod/{year}")
            papers = fetch_sigmod(year, max_papers=max_papers)
        elif conference == "VLDB":
            log.info("Crawling %s via DBLP+S2 (PVLDB)...", venue_id)
            upsert_venue(conn, id=venue_id, conference=conference, year=year, openreview_id=f"dblp:journals/pvldb/{year}")
            papers = fetch_pvldb(year, max_papers=max_papers)
        else:
            raise AssertionError(f"unreachable: {conference}")
        log.info("Fetched %d papers", len(papers))
        upsert_papers(conn, venue_id=venue_id, papers=papers)
    finally:
        conn.close()


@app.command(name="retell-sweep")
def retell_sweep_cmd(
    per_key_concurrency: int = typer.Option(12, help="Concurrent requests per API key."),
    limit: Optional[int] = typer.Option(None, help="Process at most N (smoke test). Resumable."),
):
    """Batch-generate detailed Chinese retellings into papers.ai_summary_v1."""
    from crawler.retell_sweep import run_sweep

    run_sweep(per_key_concurrency=per_key_concurrency, limit=limit)


@app.command(name="ingest-pdfs")
def ingest_pdfs_cmd(
    limit: Optional[int] = typer.Option(None, help="Process at most N papers (resumable)."),
    delay: float = typer.Option(2.0, help="Seconds to wait between papers (go slowly)."),
    venue: Optional[str] = typer.Option(None, help="Restrict to one venue_id, e.g. vldb-2025."),
):
    """Slowly mirror paper PDFs into MinIO and rewrite pdf_url. Resumable."""
    from crawler.pdf_ingest import ingest_pdfs

    ingest_pdfs(limit=limit, delay=delay, venue=venue)


@app.command()
def worker(poll_interval: float = 5.0):
    """Long-running worker: drains the `jobs` table."""
    conn = connect()
    log.info("Worker started, polling every %.1fs", poll_interval)
    try:
        while True:
            did = process_one_job(conn)
            if not did:
                time.sleep(poll_interval)
    except KeyboardInterrupt:
        log.info("Stopped.")
    finally:
        conn.close()


if __name__ == "__main__":
    app()
