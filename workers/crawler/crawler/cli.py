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
from crawler.store import (
    connect,
    process_one_job,
    upsert_papers,
    upsert_venue,
)

load_dotenv()
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


@app.command()
def crawl(
    conference: str,
    year: int,
    max_papers: Optional[int] = typer.Option(None),
    fetch_reviews: bool = typer.Option(False, help="Also pull per-paper reviews; slow & needs OpenReview login on most venues."),
):
    """Ingest one conference-year via OpenReview."""
    conference = conference.upper().replace("NEURIPS", "NeurIPS")
    if conference not in OPENREVIEW_VENUE_ID:
        raise typer.BadParameter(f"Unknown conference: {conference}")

    venue_id = f"{conference.lower()}-{year}"
    openreview_id = OPENREVIEW_VENUE_ID[conference].format(year=year)
    log.info("Crawling %s (%s)...", venue_id, openreview_id)

    conn = connect()
    try:
        upsert_venue(conn, id=venue_id, conference=conference, year=year, openreview_id=openreview_id)
        papers = fetch_venue(openreview_id, max_papers=max_papers, fetch_reviews=fetch_reviews)
        log.info("Fetched %d papers", len(papers))
        upsert_papers(conn, venue_id=venue_id, papers=papers)
    finally:
        conn.close()


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
