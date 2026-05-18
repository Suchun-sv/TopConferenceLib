"use client";

import { useState, useTransition } from "react";
import { syncLikedToOpenPaper } from "@/app/actions";

export function OpenPaperBatchBar({ count }: { count: number }) {
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  function run() {
    start(async () => {
      setMsg("同步中…");
      try {
        const result = await syncLikedToOpenPaper(Math.min(count, 20));
        setMsg(`已同步：新排队 ${result.queued}，已存在 ${result.existing}，失败 ${result.failed}。`);
      } catch (error: any) {
        setMsg(`失败：${error?.message ?? error}`);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <button
        onClick={run}
        disabled={pending || count === 0}
        className="rounded bg-indigo-600 px-3 py-1.5 text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        {pending ? "同步中…" : `Sync ${count} liked to OpenPaper`}
      </button>
      {msg && <span className="text-xs text-zinc-500">{msg}</span>}
    </div>
  );
}
