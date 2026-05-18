"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { sendToKhoj } from "@/app/actions";

type S = "none" | "pending" | "done" | "failed";

export function KhojButton({ paperId, initialStatus }: { paperId: string; initialStatus?: S }) {
  const [s, setS] = useState<S>(initialStatus ?? "none");
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // initial probe + poll while pending
    let active = true;
    const probe = async () => {
      try {
        const r = await fetch(`/api/me/khoj-export/status?ids=${encodeURIComponent(paperId)}`);
        const j = await r.json();
        const st = (j?.status?.[paperId] as S) ?? "none";
        if (active) setS(st);
        if (st !== "pending" && timer.current) {
          clearInterval(timer.current);
          timer.current = null;
        }
      } catch {}
    };
    probe();
    return () => {
      active = false;
      if (timer.current) clearInterval(timer.current);
    };
  }, [paperId]);

  function poll() {
    if (timer.current) return;
    timer.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/me/khoj-export/status?ids=${encodeURIComponent(paperId)}`);
        const j = await r.json();
        const st = (j?.status?.[paperId] as S) ?? "pending";
        setS(st);
        if (st !== "pending" && timer.current) {
          clearInterval(timer.current);
          timer.current = null;
        }
      } catch {}
    }, 4000);
  }

  function go(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (pending || s === "pending") return;
    setS("pending");
    start(async () => {
      try {
        await sendToKhoj(paperId);
        poll();
      } catch {
        setS("failed");
      }
    });
  }

  const label =
    s === "done" ? "✓ Khoj" : s === "pending" ? "⏳ Khoj" : s === "failed" ? "⚠ Khoj" : "→ Khoj";
  const cls =
    s === "done"
      ? "border-emerald-300 text-emerald-700"
      : s === "failed"
        ? "border-red-300 text-red-700"
        : "border-zinc-300 text-zinc-700 hover:bg-zinc-100";

  return (
    <button
      onClick={go}
      disabled={pending || s === "pending"}
      title={
        s === "done"
          ? "已推送到 Khoj（点可重推）"
          : s === "failed"
            ? "推送失败，点击重试"
            : "推送到 Khoj 深读"
      }
      className={`rounded border px-2 py-1 text-xs ${cls}`}
    >
      {label}
    </button>
  );
}
