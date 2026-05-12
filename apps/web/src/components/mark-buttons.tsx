"use client";

import { useOptimistic, useTransition } from "react";
import { toggleLater, toggleLike } from "@/app/actions";

type Marks = { liked: boolean; later: boolean };

export function MarkButtons({
  paperId,
  initial,
}: {
  paperId: string;
  initial: Marks;
}) {
  const [optimistic, setOptimistic] = useOptimistic(initial, (state, patch: Partial<Marks>) => ({ ...state, ...patch }));
  const [pending, start] = useTransition();

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-label="favorite"
        disabled={pending}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const next = !optimistic.liked;
          start(async () => {
            setOptimistic({ liked: next });
            await toggleLike(paperId, next);
          });
        }}
        className={`rounded p-1 text-base leading-none transition hover:bg-zinc-100 active:scale-95 ${optimistic.liked ? "text-rose-500" : "text-zinc-400 hover:text-zinc-600"}`}
      >
        {optimistic.liked ? "♥" : "♡"}
      </button>
      <button
        type="button"
        aria-label="read later"
        disabled={pending}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const next = !optimistic.later;
          start(async () => {
            setOptimistic({ later: next });
            await toggleLater(paperId, next);
          });
        }}
        className={`rounded p-1 text-base leading-none transition hover:bg-zinc-100 active:scale-95 ${optimistic.later ? "text-amber-500" : "text-zinc-400 hover:text-zinc-600"}`}
      >
        {optimistic.later ? "★" : "☆"}
      </button>
    </div>
  );
}
