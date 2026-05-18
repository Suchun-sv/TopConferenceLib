"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GroupedVirtuoso, GroupedVirtuosoHandle } from "react-virtuoso";
import { PaperRow, PaperRowItem } from "./paper-row";

type Row = PaperRowItem & { primaryArea: string };
type Section = { area: string; rows: Row[] };
type Bookmark = { paperId: string; label: string | null; title: string; titleZh: string | null };

function slugSection(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

export function VenueList({ venueId, unseen }: { venueId: string; unseen: boolean }) {
  const [sections, setSections] = useState<Section[] | null>(null);
  const [total, setTotal] = useState(0);
  const [unseenCount, setUnseenCount] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [bmOpen, setBmOpen] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);
  const ref = useRef<GroupedVirtuosoHandle>(null);

  useEffect(() => {
    const ctl = new AbortController();
    const qs = unseen ? "?unseen=1" : "";
    fetch(`/api/venue/${encodeURIComponent(venueId)}/papers${qs}`, { signal: ctl.signal })
      .then((r) => r.json())
      .then((d) => {
        if (d?.error) throw new Error(d.error);
        setSections(d.sections);
        setTotal(d.total);
        setUnseenCount(d.unseenCount ?? 0);
      })
      .catch((e) => {
        if (e?.name !== "AbortError") setErr(e?.message ?? "fetch failed");
      });
    return () => ctl.abort();
  }, [venueId, unseen]);

  useEffect(() => {
    fetch(`/api/me/venue/${encodeURIComponent(venueId)}/bookmarks`)
      .then((r) => r.json())
      .then((d) => setBookmarks(d?.bookmarks ?? []))
      .catch(() => {});
  }, [venueId]);

  const { groupCounts, flatRows, indexByPaper } = useMemo(() => {
    if (!sections)
      return { groupCounts: [] as number[], flatRows: [] as Row[], indexByPaper: new Map<string, number>() };
    const counts = sections.map((s) => s.rows.length);
    const flat: Row[] = [];
    const idx = new Map<string, number>();
    for (const s of sections) for (const r of s.rows) { idx.set(r.id, flat.length); flat.push(r); }
    return { groupCounts: counts, flatRows: flat, indexByPaper: idx };
  }, [sections]);

  const groupOffsets = useMemo(() => {
    const offs: number[] = [];
    let acc = 0;
    for (const c of groupCounts) { offs.push(acc); acc += c; }
    return offs;
  }, [groupCounts]);

  const onBookmarkChange = useCallback(
    (paperId: string, on: boolean, label: string | null) => {
      setBookmarks((prev) => {
        const without = prev.filter((b) => b.paperId !== paperId);
        if (!on) return without;
        const row = flatRows.find((r) => r.id === paperId);
        return [
          { paperId, label, title: row?.title ?? paperId, titleZh: row?.titleZh ?? null },
          ...without,
        ];
      });
      // keep the underlying row state in sync so the icon persists on re-render
      const row = flatRows.find((r) => r.id === paperId);
      if (row) {
        row.bookmarked = on;
        row.bookmarkLabel = label;
      }
    },
    [flatRows],
  );

  const jumpTo = useCallback(
    (paperId: string) => {
      const i = indexByPaper.get(paperId);
      if (i == null) {
        // bookmarked paper is filtered out by ?unseen=1 — drop the filter and retry
        if (unseen) {
          window.location.href = `?#bm-${paperId}`;
        }
        return;
      }
      ref.current?.scrollToIndex({ index: i, align: "start" });
      setBmOpen(false);
      setFlashId(paperId);
      setTimeout(() => setFlashId((c) => (c === paperId ? null : c)), 1600);
    },
    [indexByPaper, unseen],
  );

  if (err) return <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">⚠ {err}</p>;
  if (!sections) return <p className="py-8 text-center text-sm text-zinc-400">loading…</p>;
  if (sections.length === 0) {
    return <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500">No papers match this filter.</p>;
  }

  return (
    <div className="space-y-3">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-600">
        <span>
          {total} papers in {sections.length} sections · sorted A–Z, then oral / spotlight / poster
        </span>
        <a
          href={unseen ? "?" : "?unseen=1"}
          className={`rounded border px-2 py-0.5 text-xs ${
            unseen ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 text-zinc-700 hover:bg-zinc-100"
          }`}
        >
          {unseen ? "Showing unseen" : `Show unseen only (${unseenCount})`}
        </a>
        {bookmarks.length > 0 && (
          <button
            onClick={() => setBmOpen((v) => !v)}
            className="rounded border border-sky-300 px-2 py-0.5 text-xs text-sky-700 hover:bg-sky-50"
          >
            📖 Bookmarks ({bookmarks.length}) {bmOpen ? "▾" : "▸"}
          </button>
        )}
      </p>

      {bmOpen && bookmarks.length > 0 && (
        <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-200 bg-white text-sm">
          {bookmarks.map((b) => (
            <li key={b.paperId} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <span className="font-medium text-sky-700">{b.label || "Bookmark"}</span>
                <span className="ml-2 truncate text-zinc-500">
                  {b.titleZh || b.title}
                </span>
              </div>
              <button
                onClick={() => jumpTo(b.paperId)}
                className="shrink-0 rounded border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-100"
              >
                跳转 →
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* TOC */}
      <details className="rounded-md border border-zinc-200 bg-white p-3">
        <summary className="cursor-pointer select-none text-sm font-medium">
          Jump to section ({sections.length})
        </summary>
        <ul className="mt-2 grid gap-x-3 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {sections.map((s, i) => (
            <li key={s.area}>
              <button
                onClick={() => ref.current?.scrollToIndex({ index: groupOffsets[i], align: "start" })}
                className="block w-full truncate text-left text-zinc-600 hover:text-zinc-900 hover:underline"
                title={s.area}
              >
                {s.area}{" "}
                <span className="text-xs text-zinc-400">({s.rows.length})</span>
              </button>
            </li>
          ))}
        </ul>
      </details>

      <GroupedVirtuoso
        ref={ref}
        groupCounts={groupCounts}
        useWindowScroll
        groupContent={(idx) => (
          <h2
            id={slugSection(sections[idx].area)}
            className="bg-white py-1 text-sm font-semibold uppercase tracking-wide text-zinc-700"
          >
            {sections[idx].area}{" "}
            <span className="font-normal text-zinc-400">· {sections[idx].rows.length}</span>
          </h2>
        )}
        itemContent={(flatIdx) => {
          const row = flatRows[flatIdx];
          return (
            <div
              className={
                flashId === row.id
                  ? "rounded bg-yellow-100 transition-colors duration-1000"
                  : "transition-colors duration-1000"
              }
            >
              <PaperRow p={row} bookmark={{ venueId, onChange: onBookmarkChange }} />
            </div>
          );
        }}
      />
    </div>
  );
}
