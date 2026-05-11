import Link from "next/link";

export type PaperListItem = {
  id: string;
  title: string;
  authors: string[];
  venueId: string;
  decision: string | null;
  avgRating: number | null;
  stdRating: number | null;
  keywords: string[];
  aiOneliner: string | null;
};

const decisionBadge: Record<string, string> = {
  "accept-oral": "bg-amber-100 text-amber-900",
  "accept-spotlight": "bg-purple-100 text-purple-900",
  "accept-poster": "bg-emerald-100 text-emerald-900",
  "accept": "bg-emerald-100 text-emerald-900",
  "reject": "bg-zinc-200 text-zinc-700",
  "withdrawn": "bg-zinc-200 text-zinc-500",
};

export function PaperCard({ p }: { p: PaperListItem }) {
  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-4 hover:shadow-sm">
      <div className="mb-1 flex items-start justify-between gap-3">
        <Link href={`/p/${p.id}`} className="text-base font-medium leading-snug hover:underline">
          {p.title}
        </Link>
        <div className="flex shrink-0 items-center gap-1.5 text-xs">
          {p.decision && (
            <span className={`rounded px-1.5 py-0.5 ${decisionBadge[p.decision] ?? "bg-zinc-100"}`}>
              {p.decision.replace("accept-", "")}
            </span>
          )}
          {p.avgRating != null && (
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-700">
              ★ {p.avgRating.toFixed(1)}
              {p.stdRating != null && p.stdRating > 1.5 && (
                <span className="ml-1 text-orange-600">±{p.stdRating.toFixed(1)}</span>
              )}
            </span>
          )}
        </div>
      </div>
      <p className="mb-2 text-xs text-zinc-500">
        {p.authors.slice(0, 4).join(", ")}{p.authors.length > 4 && ` +${p.authors.length - 4}`}
        <span className="ml-2 text-zinc-400">·</span>
        <span className="ml-2">{p.venueId}</span>
      </p>
      {p.aiOneliner && <p className="mb-2 text-sm text-zinc-700">{p.aiOneliner}</p>}
      {p.keywords.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {p.keywords.slice(0, 6).map((k) => (
            <span key={k} className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600">
              {k}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}
