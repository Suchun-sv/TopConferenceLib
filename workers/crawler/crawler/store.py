"""Postgres write path. Mirrors the Drizzle schema in packages/db.

The schema is *owned* by Drizzle. This module just inserts/updates rows.
"""
from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

import psycopg
from psycopg.rows import dict_row

from crawler.openreview_source import PaperRecord

log = logging.getLogger("tcr.crawler.store")


def connect():
    url = os.environ["DATABASE_URL"]
    return psycopg.connect(url, row_factory=dict_row, autocommit=False)


# ---------- venue ----------

def upsert_venue(conn, id: str, conference: str, year: int, openreview_id: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into venues (id, conference, year, openreview_id, crawled_at)
            values (%s, %s, %s, %s, now())
            on conflict (id) do update
              set openreview_id = excluded.openreview_id,
                  crawled_at = now()
            """,
            (id, conference, year, openreview_id),
        )
    conn.commit()


# ---------- papers ----------

def upsert_papers(conn, venue_id: str, papers: list[PaperRecord]) -> None:
    if not papers:
        return
    with conn.cursor() as cur:
        for p in papers:
            cur.execute(
                """
                insert into papers (
                  id, venue_id, title, abstract, authors, affiliations,
                  pdf_url, openreview_url, keywords, primary_area,
                  decision, avg_rating, std_rating, num_reviews,
                  updated_at
                ) values (
                  %s, %s, %s, %s, %s::jsonb, %s::jsonb,
                  %s, %s, %s::jsonb, %s,
                  %s, %s, %s, %s,
                  now()
                )
                on conflict (id) do update set
                  title = excluded.title,
                  abstract = excluded.abstract,
                  authors = excluded.authors,
                  affiliations = excluded.affiliations,
                  pdf_url = excluded.pdf_url,
                  openreview_url = excluded.openreview_url,
                  keywords = excluded.keywords,
                  primary_area = excluded.primary_area,
                  decision = excluded.decision,
                  avg_rating = excluded.avg_rating,
                  std_rating = excluded.std_rating,
                  num_reviews = excluded.num_reviews,
                  updated_at = now()
                """,
                (
                    p.id, venue_id, p.title, p.abstract,
                    json.dumps(p.authors), json.dumps(p.affiliations),
                    p.pdf_url, p.openreview_url,
                    json.dumps(p.keywords), p.primary_area,
                    p.decision, p.avg_rating, p.std_rating, p.num_reviews,
                ),
            )
            _link_keywords(cur, p.id, p.keywords, source="author")
            if p.primary_area:
                _link_keywords(cur, p.id, [p.primary_area], source="primary_area")
            _replace_reviews(cur, p.id, p.reviews)
        cur.execute(
            "update venues set paper_count = (select count(*) from papers where venue_id = %s) where id = %s",
            (venue_id, venue_id),
        )
        _refresh_keyword_counts(cur)
    conn.commit()
    log.info("Upserted %d papers into %s", len(papers), venue_id)


def _link_keywords(cur, paper_id: str, raw: Iterable[str], source: str) -> None:
    for term in raw or []:
        term = term.strip()
        if not term:
            continue
        kid = _slug(term)
        cur.execute(
            """
            insert into keywords (id, label, paper_count, recent_count)
            values (%s, %s, 0, 0)
            on conflict (id) do nothing
            """,
            (kid, term),
        )
        cur.execute(
            """
            insert into paper_keywords (paper_id, keyword_id, source)
            values (%s, %s, %s)
            on conflict do nothing
            """,
            (paper_id, kid, source),
        )


def _replace_reviews(cur, paper_id: str, reviews: list[dict[str, Any]]) -> None:
    if not reviews:
        return
    cur.execute("delete from reviews where paper_id = %s", (paper_id,))
    for r in reviews:
        cur.execute(
            """
            insert into reviews (id, paper_id, rating, confidence, summary, strengths, weaknesses, raw_content)
            values (%s, %s, %s, %s, %s, %s, %s, %s::jsonb)
            on conflict (id) do nothing
            """,
            (
                r["id"], paper_id,
                r.get("rating"), r.get("confidence"),
                r.get("summary"), r.get("strengths"), r.get("weaknesses"),
                json.dumps(r),
            ),
        )


def _refresh_keyword_counts(cur) -> None:
    cur.execute(
        """
        update keywords k set
          paper_count = sub.cnt,
          recent_count = sub.recent
        from (
          select pk.keyword_id as id,
                 count(distinct pk.paper_id) as cnt,
                 count(distinct p.id) filter (where p.published_at > now() - interval '180 days') as recent
            from paper_keywords pk
            join papers p on p.id = pk.paper_id
           group by pk.keyword_id
        ) sub
        where k.id = sub.id
        """
    )


_slug_re = re.compile(r"[^a-z0-9]+")


def _slug(s: str) -> str:
    s = s.lower().strip()
    s = _slug_re.sub("-", s).strip("-")
    return s[:128] or "unknown"


# ---------- jobs ----------

def process_one_job(conn) -> bool:
    """Claim and process one queued job. Returns True if something ran."""
    with conn.cursor() as cur:
        cur.execute(
            """
            update jobs
               set status = 'running', started_at = now()
             where id = (
               select id from jobs where status = 'queued'
               order by created_at asc for update skip locked
               limit 1
             )
             returning id, kind, payload
            """
        )
        row = cur.fetchone()
        if not row:
            conn.commit()
            return False
    conn.commit()

    job_id, kind, payload = row["id"], row["kind"], row["payload"] or {}
    log.info("→ job %s (%s) %s", job_id, kind, payload)
    try:
        if kind == "crawl":
            from crawler.openreview_source import fetch_venue
            conf = payload["conference"]
            year = int(payload["year"])
            max_papers = payload.get("maxPapers")
            venue_id = f"{conf.lower()}-{year}"
            openreview_id = {
                "ICLR": f"ICLR.cc/{year}/Conference",
                "NeurIPS": f"NeurIPS.cc/{year}/Conference",
                "ICML": f"ICML.cc/{year}/Conference",
            }[conf]
            upsert_venue(conn, id=venue_id, conference=conf, year=year, openreview_id=openreview_id)
            papers = fetch_venue(openreview_id, max_papers=max_papers)
            upsert_papers(conn, venue_id, papers)
            result = {"venueId": venue_id, "papers": len(papers)}
        elif kind == "summarize":
            from crawler.summarize import summarize_papers
            result = summarize_papers(conn, payload["paperIds"], style=payload.get("style", "both"))
        elif kind == "extract_keywords":
            # placeholder — author-supplied keywords already linked during crawl
            result = {"note": "no-op in v1; author keywords are extracted at crawl time"}
        elif kind == "khoj_export":
            from crawler.khoj_export import export_paper
            result = export_paper(conn, payload["paperId"])
        else:
            raise ValueError(f"unknown job kind: {kind}")

        with conn.cursor() as cur:
            cur.execute(
                "update jobs set status='done', result=%s::jsonb, finished_at=now() where id=%s",
                (json.dumps(result), job_id),
            )
        conn.commit()
    except Exception as e:
        log.exception("job %s failed", job_id)
        with conn.cursor() as cur:
            cur.execute(
                "update jobs set status='failed', error=%s, finished_at=now() where id=%s",
                (str(e), job_id),
            )
        conn.commit()
    return True
