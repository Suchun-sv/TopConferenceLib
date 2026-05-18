"use client";

import { useState, useTransition } from "react";
import { openInOpenPaper } from "@/app/actions";

export function OpenPaperButton({ paperId }: { paperId: string }) {
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  function run(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    start(async () => {
      setMsg("");
      try {
        const result = await openInOpenPaper(paperId);
        window.open(result.url, "_blank", "noopener,noreferrer");
        if (!result.paper_id) {
          setMsg("已开始导入，OpenPaper 处理中");
        }
      } catch (error: any) {
        setMsg(error?.message ?? "导入失败");
      }
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={run}
        disabled={pending}
        title="在 OpenPaper 中打开并精读"
        className="rounded border border-indigo-300 px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
      >
        {pending ? "⏳ OpenPaper" : "→ OpenPaper"}
      </button>
      {msg && <span className="text-[11px] text-zinc-500">{msg}</span>}
    </span>
  );
}
