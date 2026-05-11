import Link from "next/link";

export type CloudItem = { id: string; label: string; paperCount: number; recentCount: number };

/** Server-rendered, no client JS. Font size and shade scale with count. */
export function KeywordCloud({ items }: { items: CloudItem[] }) {
  if (items.length === 0) {
    return (
      <p className="text-zinc-500">
        No keywords yet. Run <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs">pnpm crawl</code> to ingest a venue.
      </p>
    );
  }

  const max = Math.max(...items.map((i) => i.paperCount));
  const min = Math.min(...items.map((i) => i.paperCount));
  const range = Math.max(1, max - min);
  const sized = items.map((i) => ({
    ...i,
    // 12px..40px font size
    size: 12 + Math.round(((i.paperCount - min) / range) * 28),
    // 0..1 shade — recent items get the accent color
    hot: i.recentCount / Math.max(1, i.paperCount),
  }));

  // Shuffle deterministically so the cloud doesn't look like a sorted list.
  sized.sort((a, b) => (hash(a.id) - hash(b.id)));

  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2 leading-tight">
      {sized.map((it) => (
        <Link
          key={it.id}
          href={`/k/${it.id}`}
          className="inline-block rounded px-1 hover:bg-zinc-100"
          style={{
            fontSize: `${it.size}px`,
            color: it.hot > 0.5 ? "#2563eb" : "#27272a",
            opacity: 0.6 + 0.4 * (it.paperCount / max),
          }}
          title={`${it.paperCount} papers${it.recentCount ? ` · ${it.recentCount} recent` : ""}`}
        >
          {it.label}
        </Link>
      ))}
    </div>
  );
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
