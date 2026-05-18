"""PVLDB (VLDB) ingestion via DBLP + Semantic Scholar.

VLDB papers are published in PVLDB (Proceedings of the VLDB Endowment) and
are fully open access on vldb.org. DBLP gives the per-volume listing with
the vldb.org PDF link and the DOI in <ee>; Semantic Scholar fills in the
abstract (DBLP has none) via DOI lookup.

Volume mapping (PVLDB vol N == year):
  vol 15 → 2022, vol 16 → 2023, vol 17 → 2024, vol 18 → 2025, ...
"""
from __future__ import annotations

import logging
import time
from typing import Optional
from xml.etree import ElementTree as ET

import httpx

from crawler.openreview_source import PaperRecord
from crawler.sigmod_source import (
    S2_BATCH,
    S2_FIELDS,
    _looks_like_editorial,
    _post_with_backoff,
)

log = logging.getLogger("tcr.crawler.pvldb")

DBLP_VOL_XML = "https://dblp.org/db/journals/pvldb/pvldb{vol}.xml"
PVLDB_VOL_FOR_YEAR = {2022: 15, 2023: 16, 2024: 17, 2025: 18, 2026: 19}
_HTTP_TIMEOUT = httpx.Timeout(60.0, read=120.0)


def fetch_pvldb(year: int, max_papers: Optional[int] = None) -> list[PaperRecord]:
    vol = PVLDB_VOL_FOR_YEAR.get(year)
    if vol is None:
        raise ValueError(
            f"PVLDB volume mapping missing for {year}; update PVLDB_VOL_FOR_YEAR"
        )

    log.info("Pulling PVLDB vol %d (= VLDB %d) from DBLP...", vol, year)
    stubs = _fetch_dblp_volume(vol)
    log.info("  DBLP listed %d articles", len(stubs))

    stubs = [
        s for s in stubs
        if not _looks_like_editorial(s) and not _is_front_matter(s)
    ]
    log.info("  %d after dropping editorials/front-matter", len(stubs))

    if max_papers:
        stubs = stubs[:max_papers]

    enriched = _enrich_via_s2(stubs)
    log.info("  %d enriched (abstracts via Semantic Scholar where available)", len(enriched))
    return enriched


def _is_front_matter(stub: dict) -> bool:
    t = stub["title"].strip().lower()
    return (
        t.startswith("front matter")
        or t.startswith("back matter")
        or t == "errata."
        or t.startswith("errata:")
        or t.startswith("erratum")
        or "table of contents" in t
    )


# ---------- DBLP ----------

def _fetch_dblp_volume(vol: int) -> list[dict]:
    url = DBLP_VOL_XML.format(vol=vol)
    # DBLP throttles aggressively with intermittent 503s; back off and retry.
    delay = 5.0
    with httpx.Client(headers={"User-Agent": "tcr-crawler/0.1"}, timeout=_HTTP_TIMEOUT) as c:
        for attempt in range(8):
            r = c.get(url)
            if r.status_code in (429, 500, 502, 503, 504):
                log.warning(
                    "  DBLP %s for vol %d (attempt %d), sleeping %.0fs",
                    r.status_code, vol, attempt + 1, delay,
                )
                time.sleep(delay)
                delay = min(delay * 1.8, 90.0)
                continue
            r.raise_for_status()
            xml_bytes = r.content
            break
        else:
            raise RuntimeError(f"DBLP repeatedly unavailable for pvldb vol {vol}")
    root = ET.fromstring(xml_bytes)
    out: list[dict] = []
    for art in root.iter("article"):
        raw_key = art.attrib.get("key", "")
        basename = raw_key.rsplit("/", 1)[-1]
        key = f"pvldb-{basename}" if basename else ""
        title = (art.findtext("title") or "").strip().rstrip(".")
        authors = [a.text.strip() for a in art.findall("author") if a.text]
        doi: Optional[str] = None
        pdf_url: Optional[str] = None
        for ee in art.findall("ee"):
            t = (ee.text or "").strip()
            if not t:
                continue
            if "doi.org/" in t and doi is None:
                doi = t.split("doi.org/", 1)[1]
            elif "vldb.org" in t and t.lower().endswith(".pdf") and pdf_url is None:
                pdf_url = t
        if not (title and key):
            continue
        # Need at least a DOI (for S2 abstract) or a PDF to be useful.
        if not (doi or pdf_url):
            continue
        out.append({"key": key, "title": title, "authors": authors, "doi": doi, "pdf_url": pdf_url})
    return out


# ---------- Semantic Scholar batch ----------

def _enrich_via_s2(stubs: list[dict]) -> list[PaperRecord]:
    if not stubs:
        return []
    with_doi = [s for s in stubs if s.get("doi")]
    without_doi = [s for s in stubs if not s.get("doi")]
    out: list[PaperRecord] = [_record_from_stub(s) for s in without_doi]

    BATCH = 400
    with httpx.Client(timeout=_HTTP_TIMEOUT) as c:
        for i in range(0, len(with_doi), BATCH):
            chunk = with_doi[i : i + BATCH]
            ids = [f"DOI:{s['doi']}" for s in chunk]
            log.info(
                "  S2 batch %d/%d (%d ids)",
                i // BATCH + 1,
                (len(with_doi) + BATCH - 1) // BATCH,
                len(ids),
            )
            resp = _post_with_backoff(
                c, S2_BATCH, params={"fields": S2_FIELDS}, json={"ids": ids}
            )
            data = resp.json()
            if not isinstance(data, list):
                log.warning("  unexpected S2 batch response: %r", data)
                out.extend(_record_from_stub(s) for s in chunk)
                continue
            for stub, item in zip(chunk, data):
                out.append(_record_from_s2(stub, item) if item else _record_from_stub(stub))
            time.sleep(1.2)
    return out


def _best_pdf(stub: dict, item: Optional[dict]) -> Optional[str]:
    # vldb.org open-access PDF (from DBLP) is canonical and clean — prefer it.
    if stub.get("pdf_url"):
        return stub["pdf_url"]
    if item:
        arxiv_id = (item.get("externalIds") or {}).get("ArXiv")
        if arxiv_id:
            return f"https://arxiv.org/pdf/{arxiv_id}"
        oa = (item.get("openAccessPdf") or {}).get("url")
        if oa:
            return oa
    return None


def _landing(stub: dict) -> Optional[str]:
    if stub.get("doi"):
        return f"https://doi.org/{stub['doi']}"
    return stub.get("pdf_url")


def _record_from_s2(stub: dict, item: dict) -> PaperRecord:
    title = (item.get("title") or stub["title"]).strip().rstrip(".")
    authors = [a.get("name", "") for a in (item.get("authors") or [])] or stub["authors"]
    return PaperRecord(
        id=stub["key"],
        title=title,
        abstract=item.get("abstract"),
        authors=authors,
        affiliations=[],
        keywords=[],
        primary_area=None,
        decision="accept",
        pdf_url=_best_pdf(stub, item),
        openreview_url=_landing(stub),
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
        pdf_url=_best_pdf(stub, None),
        openreview_url=_landing(stub),
    )
