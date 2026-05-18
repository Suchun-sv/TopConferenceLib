"use client";

import { useState } from "react";
import { MarkdownView } from "./markdown-view";

type FullSummary = { aiSummaryV1: string | null; aiSummaryV1At: string | null };

export function SummaryReveal({ paperId }: { paperId: string }) {
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState<FullSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function ensureFull() {
    if (full || loading) return;
    setLoading(true);
    setErr(null);
    const url = `/api/paper/${encodeURIComponent(paperId)}/summary`;
    try {
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
      const ct = r.headers.get("content-type") ?? "";
      if (!ct.includes("application/json")) {
        const snippet = (await r.text()).slice(0, 120);
        throw new Error(`non-JSON response (${ct}); first bytes: ${snippet}`);
      }
      const j = (await r.json()) as FullSummary;
      setFull(j);
    } catch (e: any) {
      console.error("SummaryReveal fetch", url, e);
      setErr(`${e?.name ?? "Error"}: ${e?.message ?? e}`);
    } finally {
      setLoading(false);
    }
  }

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    const next = !open;
    setOpen(next);
    if (next) ensureFull();
  }

  return (
    <div className="mt-1">
      <button
        onClick={toggle}
        className="text-xs text-zinc-500 hover:text-zinc-900"
        aria-expanded={open}
      >
        {open ? "▾" : "▸"} 详细解读
      </button>
      {open && (
        <div
          className="mt-1 max-h-[60vh] overflow-auto rounded-md border border-zinc-200 bg-zinc-50 p-2 text-[13px] leading-relaxed text-zinc-700"
          onClick={(e) => e.stopPropagation()}
        >
          {loading ? (
            <p className="text-zinc-400">loading…</p>
          ) : err ? (
            <p className="text-red-600">{err}</p>
          ) : full?.aiSummaryV1 ? (
            <MarkdownView source={full.aiSummaryV1} />
          ) : (
            <p className="text-zinc-400">(no summary)</p>
          )}
        </div>
      )}
    </div>
  );
}
