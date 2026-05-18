import Link from "next/link";
import { MarkButtons } from "./mark-buttons";
import { AbstractReveal } from "./abstract-reveal";
import { SummaryReveal } from "./summary-reveal";
import { mdTeaser } from "@/lib/md-teaser";
import { BookmarkButton } from "./bookmark-button";

export type PaperRowItem = {
  id: string;
  title: string;
  titleZh: string | null;
  authors: string[];
  decision: string | null;
  interestScore: number | null;
  abstractTeaser?: string | null;
  aiSummaryV1Teaser?: string | null;
  openreviewUrl: string | null;
  pdfUrl: string | null;
  liked: boolean;
  later: boolean;
  viewedAt?: string | null;
  bookmarked?: boolean;
  bookmarkLabel?: string | null;
};

export type BookmarkBinding = {
  venueId: string;
  onChange: (paperId: string, bookmarked: boolean, label: string | null) => void;
};

const decisionStyle: Record<string, string> = {
  "accept-oral": "bg-amber-100 text-amber-900 border-amber-300",
  "accept-spotlight": "bg-purple-100 text-purple-900 border-purple-300",
  "accept-poster": "bg-emerald-50 text-emerald-800 border-emerald-200",
  "accept": "bg-emerald-50 text-emerald-800 border-emerald-200",
};

function teaser(text: string | null | undefined, max = 140): string {
  if (!text) return "";
  const s = text.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return s.slice(0, max).replace(/[，。,.\s][^，。,.\s]*$/, "") + "…";
}

export function PaperRow({ p, bookmark }: { p: PaperRowItem; bookmark?: BookmarkBinding }) {
  const dec = p.decision ?? "";
  const decShort = dec.replace("accept-", "");
  const seen = !!p.viewedAt;
  const previewText = p.aiSummaryV1Teaser ? mdTeaser(p.aiSummaryV1Teaser) : teaser(p.abstractTeaser);

  return (
    <li className="group flex items-start gap-2 border-b border-zinc-100 py-2 last:border-b-0 sm:gap-3">
      {/* index marker / decision badge */}
      <span
        className={`mt-0.5 inline-block w-14 shrink-0 rounded border px-1.5 py-0.5 text-center text-[10px] font-medium uppercase tracking-wide sm:w-16 ${
          seen
            ? "border-zinc-200 bg-zinc-50 text-zinc-400"
            : decisionStyle[dec] ?? "border-zinc-200 bg-zinc-50 text-zinc-500"
        }`}
        title={seen ? "已浏览" : undefined}
      >
        {seen ? "✓" : decShort || "—"}
      </span>

      {/* title + meta */}
      <div className="min-w-0 flex-1">
        <Link href={`/p/${p.id}`} className="block">
          <h3
            className={`text-sm font-medium leading-snug group-hover:underline sm:text-[15px] ${
              seen ? "text-zinc-400" : "text-zinc-900"
            }`}
          >
            {p.title}
          </h3>
          {p.titleZh && (
            <p
              className={`mt-0.5 text-[13px] leading-snug sm:text-sm ${
                seen ? "text-zinc-400" : "text-zinc-500"
              }`}
            >
              {p.titleZh}
            </p>
          )}
        </Link>
        <p className={`mt-1 truncate text-xs ${seen ? "text-zinc-400" : "text-zinc-500"}`}>
          {p.authors.slice(0, 3).join(", ")}
          {p.authors.length > 3 && ` +${p.authors.length - 3}`}
        </p>
        {previewText && (
          <p className={`mt-1 line-clamp-3 text-[12.5px] leading-snug ${seen ? "text-zinc-400" : "text-zinc-600"}`}>
            {previewText}
          </p>
        )}
        {p.aiSummaryV1Teaser ? (
          <SummaryReveal paperId={p.id} />
        ) : (
          <AbstractReveal paperId={p.id} />
        )}
      </div>

      {/* right rail: score + marks */}
        <div className="flex shrink-0 items-center gap-1.5">
        {p.interestScore != null && (
          <span
            className={`text-[11px] font-semibold ${seen ? "text-amber-300" : "text-amber-500"}`}
            title={`AI interest score ${p.interestScore.toFixed(1)} / 5`}
          >
            {"★".repeat(Math.round(p.interestScore))}
          </span>
        )}
          <MarkButtons paperId={p.id} initial={{ liked: p.liked, later: p.later }} />
          {bookmark && (
            <BookmarkButton
            venueId={bookmark.venueId}
            paperId={p.id}
            initial={!!p.bookmarked}
            initialLabel={p.bookmarkLabel ?? null}
            onChange={(b, l) => bookmark.onChange(p.id, b, l)}
          />
        )}
      </div>
    </li>
  );
}
