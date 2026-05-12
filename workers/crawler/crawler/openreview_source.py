"""OpenReview ingestion.

Uses the v2 client. Pulls accepted submissions + their reviews + author keywords.
For unauthenticated access we get accept decisions / titles / abstracts / keywords,
but not raw reviewer scores on every venue — for that, set OPENREVIEW_USERNAME/PASSWORD.
"""
from __future__ import annotations

import logging
import os
import statistics
from dataclasses import dataclass, field
from typing import Any, Iterable, Optional

log = logging.getLogger("tcr.crawler.openreview")


@dataclass
class PaperRecord:
    id: str
    title: str
    abstract: Optional[str]
    authors: list[str] = field(default_factory=list)
    affiliations: list[str] = field(default_factory=list)
    keywords: list[str] = field(default_factory=list)
    primary_area: Optional[str] = None
    decision: Optional[str] = None
    avg_rating: Optional[float] = None
    std_rating: Optional[float] = None
    num_reviews: int = 0
    pdf_url: Optional[str] = None
    openreview_url: Optional[str] = None
    reviews: list[dict[str, Any]] = field(default_factory=list)


def _client():
    """Return an OpenReview v2 client (anonymous unless creds are set)."""
    from openreview.api import OpenReviewClient

    return OpenReviewClient(
        baseurl="https://api2.openreview.net",
        username=os.getenv("OPENREVIEW_USERNAME"),
        password=os.getenv("OPENREVIEW_PASSWORD"),
    )


def fetch_venue(
    venue_id: str,
    max_papers: Optional[int] = None,
    fetch_reviews: bool = False,
) -> list[PaperRecord]:
    """Pull every submission for a venue.

    Reviews are expensive (1 extra API call per paper) and on most public venues
    require login to see ratings — off by default. Use `fetch_reviews=True`
    after you set OPENREVIEW_USERNAME / OPENREVIEW_PASSWORD.
    """
    client = _client()
    log.info("Pulling submissions for %s...", venue_id)

    submissions = client.get_all_notes(content={"venueid": venue_id})
    log.info("  %d submissions", len(submissions))
    if max_papers:
        submissions = submissions[:max_papers]

    out: list[PaperRecord] = []
    from tqdm import tqdm
    for s in tqdm(submissions, desc="parsing", unit="paper"):
        rec = _submission_to_record(s)
        if fetch_reviews:
            try:
                _attach_reviews(client, rec, s.id)
            except Exception as e:
                log.debug("review fetch failed for %s: %s", s.id, e)
        out.append(rec)
    return out


def _submission_to_record(s) -> PaperRecord:
    c = _flatten(s.content)
    forum = s.forum or s.id
    return PaperRecord(
        id=forum,
        title=c.get("title", "").strip(),
        abstract=c.get("abstract"),
        authors=_as_list(c.get("authors")),
        affiliations=_as_list(c.get("authorids")),
        keywords=_as_list(c.get("keywords")),
        primary_area=c.get("primary_area"),
        decision=_decision(c),
        pdf_url=f"https://openreview.net/pdf?id={forum}",
        openreview_url=f"https://openreview.net/forum?id={forum}",
    )


def _attach_reviews(client, rec: PaperRecord, forum_id: str) -> None:
    notes = client.get_all_notes(forum=forum_id)
    ratings: list[float] = []
    raw: list[dict[str, Any]] = []
    for n in notes:
        c = _flatten(n.content)
        # OpenReview's "Official Review" invitations vary by venue.
        rating = c.get("rating")
        if rating is None:
            continue
        try:
            r = float(str(rating).split(":")[0])
        except ValueError:
            continue
        ratings.append(r)
        raw.append({
            "id": n.id,
            "rating": r,
            "confidence": _safe_float(c.get("confidence")),
            "summary": c.get("summary"),
            "strengths": c.get("strengths"),
            "weaknesses": c.get("weaknesses"),
        })
    if ratings:
        rec.avg_rating = sum(ratings) / len(ratings)
        rec.std_rating = statistics.pstdev(ratings) if len(ratings) > 1 else 0.0
        rec.num_reviews = len(ratings)
        rec.reviews = raw


def _flatten(content: dict[str, Any]) -> dict[str, Any]:
    """OpenReview v2 wraps each value in {'value': ...}. Flatten it."""
    out: dict[str, Any] = {}
    for k, v in (content or {}).items():
        out[k] = v["value"] if isinstance(v, dict) and "value" in v else v
    return out


def _as_list(v) -> list[str]:
    if v is None:
        return []
    if isinstance(v, list):
        return [str(x) for x in v]
    return [str(v)]


def _decision(c: dict[str, Any]) -> Optional[str]:
    venue = (c.get("venue") or "").lower()
    if "oral" in venue:
        return "accept-oral"
    if "spotlight" in venue:
        return "accept-spotlight"
    if "poster" in venue or "accept" in venue:
        return "accept-poster"
    if "reject" in venue:
        return "reject"
    if "withdrawn" in venue:
        return "withdrawn"
    return None


def _safe_float(v) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(str(v).split(":")[0])
    except (ValueError, TypeError):
        return None
