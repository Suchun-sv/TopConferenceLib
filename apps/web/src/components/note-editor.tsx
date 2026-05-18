"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { setNote } from "@/app/actions";

export function NoteEditor({ paperId, initial }: { paperId: string; initial: string }) {
  const [value, setValue] = useState(initial);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const lastSaved = useRef(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (value === lastSaved.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const snapshot = value;
      startTransition(async () => {
        await setNote(paperId, snapshot);
        lastSaved.current = snapshot;
        setSavedAt(Date.now());
      });
    }, 600);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, paperId]);

  return (
    <div className="space-y-1">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={4}
        placeholder="Your private notes on this paper…"
        className="w-full resize-y rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm leading-relaxed text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-zinc-400"
      />
      <p className="text-right text-[11px] text-zinc-400">
        {pending ? "saving…" : savedAt ? "saved" : value === initial ? "" : "unsaved"}
      </p>
    </div>
  );
}
