"use client";

import { useEffect, useState, useTransition } from "react";
import { toggleLater, toggleLike } from "@/app/actions";

type Marks = { liked: boolean; later: boolean };

export function MarkButtons({
  paperId,
  initial,
}: {
  paperId: string;
  initial: Marks;
}) {
  const [state, setState] = useState(initial);
  const [pending, start] = useTransition();
  // When virtuoso recycles this component for a different paper, sync to the new initial state.
  useEffect(() => {
    setState(initial);
  }, [paperId]);

  function flip(key: keyof Marks, action: (id: string, v: boolean) => Promise<unknown>) {
    const next = !state[key];
    const prev = state;
    setState({ ...prev, [key]: next });
    start(async () => {
      try {
        await action(paperId, next);
      } catch {
        setState(prev); // revert on failure
      }
    });
  }

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-label="favorite"
        disabled={pending}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          flip("liked", toggleLike);
        }}
        className={`rounded p-1 text-base leading-none transition hover:bg-zinc-100 active:scale-95 ${state.liked ? "text-rose-500" : "text-zinc-400 hover:text-zinc-600"}`}
      >
        {state.liked ? "♥" : "♡"}
      </button>
      <button
        type="button"
        aria-label="read later"
        disabled={pending}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          flip("later", toggleLater);
        }}
        className={`rounded p-1 text-base leading-none transition hover:bg-zinc-100 active:scale-95 ${state.later ? "text-amber-500" : "text-zinc-400 hover:text-zinc-600"}`}
      >
        {state.later ? "★" : "☆"}
      </button>
    </div>
  );
}
