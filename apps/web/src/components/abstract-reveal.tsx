"use client";

import { useState } from "react";

type FullAbstract = { abstract: string | null; abstractZh: string | null };

export function AbstractReveal({
  paperId,
  eager,
}: {
  paperId: string;
  eager?: FullAbstract;
}) {
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState<FullAbstract | null>(eager ?? null);
  const [lang, setLang] = useState<"zh" | "en">("zh");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function ensureFull() {
    if (full || loading) return;
    setLoading(true);
    setErr(null);
    const url = `/api/paper/${encodeURIComponent(paperId)}/abstract`;
    try {
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
      const ct = r.headers.get("content-type") ?? "";
      if (!ct.includes("application/json")) {
        // Most common: a Cloudflare Access login / error page came back as HTML.
        const snippet = (await r.text()).slice(0, 120);
        throw new Error(`non-JSON response (${ct}); first bytes: ${snippet}`);
      }
      const j = (await r.json()) as FullAbstract;
      setFull(j);
      setLang(j.abstractZh ? "zh" : "en");
    } catch (e: any) {
      console.error("AbstractReveal fetch", url, e);
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

  const text =
    full && (lang === "zh" ? full.abstractZh ?? full.abstract : full.abstract ?? full.abstractZh) || "";
  const canSwitch = !!(full?.abstractZh && full?.abstract);

  return (
    <div className="mt-1">
      <button
        onClick={toggle}
        className="text-xs text-zinc-500 hover:text-zinc-900"
        aria-expanded={open}
      >
        {open ? "▾" : "▸"} 摘要
      </button>
      {open && (
        <div
          className="mt-1 rounded-md border border-zinc-200 bg-zinc-50 p-2 text-[13px] leading-relaxed text-zinc-700"
          onClick={(e) => e.stopPropagation()}
        >
          {canSwitch && (
            <div className="mb-1 flex gap-1 text-[11px]">
              <button
                onClick={() => setLang("zh")}
                className={`rounded px-1.5 py-0.5 ${lang === "zh" ? "bg-zinc-900 text-white" : "text-zinc-500 hover:bg-zinc-200"}`}
              >
                中
              </button>
              <button
                onClick={() => setLang("en")}
                className={`rounded px-1.5 py-0.5 ${lang === "en" ? "bg-zinc-900 text-white" : "text-zinc-500 hover:bg-zinc-200"}`}
              >
                EN
              </button>
            </div>
          )}
          {loading ? (
            <p className="text-zinc-400">loading…</p>
          ) : err ? (
            <p className="text-red-600">{err}</p>
          ) : text ? (
            <p className="whitespace-pre-line">{text}</p>
          ) : (
            <p className="text-zinc-400">(no abstract)</p>
          )}
        </div>
      )}
    </div>
  );
}
