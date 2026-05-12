import Link from "next/link";
import { MarkButtons } from "./mark-buttons";

export type PaperRowItem = {
  id: string;
  title: string;
  titleZh: string | null;
  authors: string[];
  decision: string | null;
  interestScore: number | null;
  openreviewUrl: string | null;
  pdfUrl: string | null;
  liked: boolean;
  later: boolean;
};

const decisionStyle: Record<string, string> = {
  "accept-oral": "bg-amber-100 text-amber-900 border-amber-300",
  "accept-spotlight": "bg-purple-100 text-purple-900 border-purple-300",
  "accept-poster": "bg-emerald-50 text-emerald-800 border-emerald-200",
  "accept": "bg-emerald-50 text-emerald-800 border-emerald-200",
};

export function PaperRow({ p }: { p: PaperRowItem }) {
  const dec = p.decision ?? "";
  const decShort = dec.replace("accept-", "");

  return (
    <li className="group flex items-start gap-2 border-b border-zinc-100 py-2 last:border-b-0 sm:gap-3">
      {/* index marker / decision badge */}
      <span
        className={`mt-0.5 inline-block w-14 shrink-0 rounded border px-1.5 py-0.5 text-center text-[10px] font-medium uppercase tracking-wide sm:w-16 ${decisionStyle[dec] ?? "border-zinc-200 bg-zinc-50 text-zinc-500"}`}
      >
        {decShort || "—"}
      </span>

      {/* title + meta */}
      <div className="min-w-0 flex-1">
        <Link href={`/p/${p.id}`} className="block">
          <h3 className="text-sm font-medium leading-snug text-zinc-900 group-hover:underline sm:text-[15px]">
            {p.title}
          </h3>
          {p.titleZh && (
            <p className="mt-0.5 text-[13px] leading-snug text-zinc-500 sm:text-sm">{p.titleZh}</p>
          )}
        </Link>
        <p className="mt-1 truncate text-xs text-zinc-500">
          {p.authors.slice(0, 3).join(", ")}
          {p.authors.length > 3 && ` +${p.authors.length - 3}`}
        </p>
      </div>

      {/* right rail: score + marks */}
      <div className="flex shrink-0 items-center gap-1.5">
        {p.interestScore != null && (
          <span
            className="text-[11px] font-semibold text-amber-500"
            title={`AI interest score ${p.interestScore.toFixed(1)} / 5`}
          >
            {"★".repeat(Math.round(p.interestScore))}
          </span>
        )}
        <MarkButtons paperId={p.id} initial={{ liked: p.liked, later: p.later }} />
      </div>
    </li>
  );
}
