"use client";

import { useState, useTransition } from "react";
import { sendBatchToKhoj } from "@/app/actions";

export function KhojBatchBar({
  tab,
  count,
  khojBaseUrl,
}: {
  tab: "liked" | "later";
  count: number;
  khojBaseUrl: string;
}) {
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  function run() {
    start(async () => {
      setMsg("enqueuing…");
      try {
        const r = await sendBatchToKhoj(tab);
        setMsg(`已排队 ${r.queued}，跳过 ${r.skipped}（共 ${r.total}）。后台下载中…`);
      } catch (e: any) {
        setMsg(`失败：${e?.message ?? e}`);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <button
        onClick={run}
        disabled={pending || count === 0}
        className="rounded bg-zinc-900 px-3 py-1.5 text-white hover:bg-zinc-800 disabled:opacity-50"
      >
        {pending ? "排队中…" : `Export all ${count} to Khoj`}
      </button>
      <a
        href={khojBaseUrl}
        target="_blank"
        rel="noreferrer"
        className="rounded border border-sky-300 px-3 py-1.5 text-sky-700 hover:bg-sky-50"
      >
        Open Khoj ↗
      </a>
      {msg && <span className="text-xs text-zinc-500">{msg}</span>}
    </div>
  );
}
