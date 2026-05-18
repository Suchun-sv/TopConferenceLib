"""SIGMOD ingestion via DBLP + Semantic Scholar.

SIGMOD papers since 2023 are published in PACMMOD (Proceedings of the ACM
on Management of Data). DBLP gives us the per-volume listing with DOIs,
but no abstracts; the Semantic Scholar batch API fills in title/abstract/
authors via DOI lookup.

Volume mapping (PACMMOD vol N == year):
  vol 1 → 2023, vol 2 → 2024, vol 3 → 2025, ...
"""
from __future__ import annotations

import logging
import time
from typing import Optional
from xml.etree import ElementTree as ET

import httpx

from crawler.openreview_source import PaperRecord

log = logging.getLogger("tcr.crawler.sigmod")

DBLP_VOL_XML = "https://dblp.org/db/journals/pacmmod/pacmmod{vol}.xml"
S2_BATCH = "https://api.semanticscholar.org/graph/v1/paper/batch"
S2_FIELDS = "title,abstract,authors,openAccessPdf,externalIds,venue,year"
PACMMOD_VOL_FOR_YEAR = {2023: 1, 2024: 2, 2025: 3, 2026: 4}
# DBLP asks for polite usage; we're well under any threshold.
_HTTP_TIMEOUT = httpx.Timeout(60.0, read=120.0)


def fetch_sigmod(year: int, max_papers: Optional[int] = None) -> list[PaperRecord]:
    vol = PACMMOD_VOL_FOR_YEAR.get(year)
    if vol is None:
        raise ValueError(f"PACMMOD volume mapping missing for {year}; update PACMMOD_VOL_FOR_YEAR")

    log.info("Pulling PACMMOD vol %d (= SIGMOD %d) from DBLP...", vol, year)
    stubs = _fetch_dblp_volume(vol)
    log.info("  DBLP listed %d articles", len(stubs))

    # Drop the editorial / front-matter rows.
    stubs = [s for s in stubs if not _looks_like_editorial(s)]
    log.info("  %d after dropping editorials/front-matter", len(stubs))

    if max_papers:
        stubs = stubs[:max_papers]

    enriched = _enrich_via_s2(stubs)
    log.info("  %d enriched with abstracts via Semantic Scholar", len(enriched))
    return enriched


# ---------- DBLP ----------

def _fetch_dblp_volume(vol: int) -> list[dict]:
    url = DBLP_VOL_XML.format(vol=vol)
    with httpx.Client(headers={"User-Agent": "tcr-crawler/0.1"}, timeout=_HTTP_TIMEOUT) as c:
        r = c.get(url)
        r.raise_for_status()
        xml_bytes = r.content
    root = ET.fromstring(xml_bytes)
    out: list[dict] = []
    for art in root.iter("article"):
        raw_key = art.attrib.get("key", "")
        # DBLP keys contain slashes ("journals/pacmmod/AgrawalMS24") which break
        # our `/p/<id>` route. Use the basename, prefixed by source.
        basename = raw_key.rsplit("/", 1)[-1]
        key = f"pacmmod-{basename}" if basename else ""
        title = (art.findtext("title") or "").strip().rstrip(".")
        authors = [a.text.strip() for a in art.findall("author") if a.text]
        doi = None
        for ee in art.findall("ee"):
            if ee.text and "doi.org/" in ee.text:
                doi = ee.text.strip().split("doi.org/", 1)[1]
                break
        if not (title and doi):
            continue
        out.append({"key": key, "title": title, "authors": authors, "doi": doi})
    return out


def _looks_like_editorial(stub: dict) -> bool:
    t = stub["title"].lower()
    return (
        t.startswith("editorial")
        or "editorial" in t and ":" in t and len(t) < 80
        or "table of contents" in t
        or t.startswith("foreword")
        or t.startswith("preface")
        or "letter from the editor" in t
    )


# ---------- Semantic Scholar batch ----------

def _enrich_via_s2(stubs: list[dict]) -> list[PaperRecord]:
    if not stubs:
        return []
    # S2 batch limit is 500 ids per call; we batch a bit smaller to be polite.
    BATCH = 400
    out: list[PaperRecord] = []
    with httpx.Client(timeout=_HTTP_TIMEOUT) as c:
        for i in range(0, len(stubs), BATCH):
            chunk = stubs[i : i + BATCH]
            ids = [f"DOI:{s['doi']}" for s in chunk]
            log.info("  S2 batch %d/%d (%d ids)", i // BATCH + 1, (len(stubs) + BATCH - 1) // BATCH, len(ids))
            body = {"ids": ids}
            resp = _post_with_backoff(c, S2_BATCH, params={"fields": S2_FIELDS}, json=body)
            data = resp.json()
            if not isinstance(data, list):
                log.warning("  unexpected S2 batch response: %r", data)
                continue
            # data is positional: same length as ids; missing == None
            for stub, item in zip(chunk, data):
                if not item:
                    # S2 doesn't know this DOI; fall back to DBLP-only fields, no abstract.
                    out.append(_record_from_stub(stub))
                    continue
                out.append(_record_from_s2(stub, item))
            # be nice
            time.sleep(1.2)
    return out


def _post_with_backoff(client: httpx.Client, url: str, *, params: dict, json: dict) -> httpx.Response:
    delay = 1.0
    for attempt in range(6):
        r = client.post(url, params=params, json=json)
        if r.status_code == 429:
            log.warning("    S2 429, sleeping %.1fs", delay)
            time.sleep(delay)
            delay = min(delay * 2, 30.0)
            continue
        r.raise_for_status()
        return r
    raise RuntimeError("S2 batch repeatedly returned 429")


def _record_from_s2(stub: dict, item: dict) -> PaperRecord:
    title = (item.get("title") or stub["title"]).strip().rstrip(".")
    authors = [a.get("name", "") for a in (item.get("authors") or [])] or stub["authors"]
    # Prefer arxiv (open access, clean), then S2's openAccessPdf, then nothing.
    arxiv_id = (item.get("externalIds") or {}).get("ArXiv")
    pdf = None
    if arxiv_id:
        pdf = f"https://arxiv.org/pdf/{arxiv_id}"
    else:
        pdf = (item.get("openAccessPdf") or {}).get("url") or None
    return PaperRecord(
        id=stub["key"],
        title=title,
        abstract=item.get("abstract"),
        authors=authors,
        affiliations=[],
        keywords=[],
        primary_area=None,
        decision="accept",
        pdf_url=pdf,
        # Repurpose openreview_url to carry the DOI landing page for non-OR venues.
        openreview_url=f"https://doi.org/{stub['doi']}",
    )


def _record_from_stub(stub: dict) -> PaperRecord:
    return PaperRecord(
        id=stub["key"],
        title=stub["title"],
        abstract=None,
        authors=stub["authors"],
        affiliations=[],
        keywords=[],
        primary_area=None,
        decision="accept",
        pdf_url=None,
        openreview_url=f"https://doi.org/{stub['doi']}",
    )
