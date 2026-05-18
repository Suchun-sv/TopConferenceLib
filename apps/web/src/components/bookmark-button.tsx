"use client";

import { useEffect, useState, useTransition } from "react";

export function BookmarkButton({
  venueId,
  paperId,
  initial,
  initialLabel,
  onChange,
}: {
  venueId: string;
  paperId: string;
  initial: boolean;
  initialLabel: string | null;
  onChange?: (bookmarked: boolean, label: string | null) => void;
}) {
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();

  useEffect(() => {
    setOn(initial);
  }, [paperId, initial]);

  function add(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const label = (window.prompt("给这个书签起个名字（可留空）", initialLabel ?? "") ?? "").trim();
    setOn(true);
    start(async () => {
      try {
        const r = await fetch(`/api/me/venue/${encodeURIComponent(venueId)}/bookmarks`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ paperId, label }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        onChange?.(true, label || null);
      } catch {
        setOn(false);
      }
    });
  }

  function remove(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm("删除这个书签？")) return;
    setOn(false);
    start(async () => {
      try {
        const r = await fetch(
          `/api/me/venue/${encodeURIComponent(venueId)}/bookmarks/${encodeURIComponent(paperId)}`,
          { method: "DELETE" },
        );
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        onChange?.(false, null);
      } catch {
        setOn(true);
      }
    });
  }

  return (
    <button
      type="button"
      aria-label={on ? "remove bookmark" : "add bookmark"}
      disabled={pending}
      onClick={on ? remove : add}
      title={on ? `书签${initialLabel ? `：${initialLabel}` : ""}（点击删除）` : "加书签"}
      className={`rounded p-1 text-base leading-none transition hover:bg-zinc-100 active:scale-95 ${
        on ? "text-sky-600" : "text-zinc-400 hover:text-zinc-600"
      }`}
    >
      {on ? "🔖" : "🏷"}
    </button>
  );
}
