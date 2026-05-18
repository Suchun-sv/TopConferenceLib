import { getMark, getPaper, markViewed } from "@tcr/db/queries";
import { notFound } from "next/navigation";
import { after } from "next/server";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { generateDeepAnalysis } from "@/lib/deep-analysis";
import { NoteEditor } from "@/components/note-editor";
import { MarkButtons } from "@/components/mark-buttons";
import { CopyForAi } from "@/components/copy-for-ai";
import { AiChatPanel } from "@/components/ai-chat-panel";
import { KhojButton } from "@/components/khoj-button";
import { MarkdownView } from "@/components/markdown-view";

export const dynamic = "force-dynamic";

export default async function PaperPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getPaper(id);
  if (!p) notFound();
  const { id: userId } = await requireUser();
  await markViewed(userId, id);
  const mark = await getMark(userId, id);

  // Backfill: papers liked/saved before this feature existed never triggered
  // generation. Kick it off on view (after the response) if still missing.
  if ((mark?.liked || mark?.later) && p.pdfUrl && !p.aiDeepAnalysis) {
    after(() => generateDeepAnalysis(id));
  }

  return (
    <article className="mx-auto max-w-3xl space-y-6">
      <header>
        <p className="text-sm text-zinc-500">{p.venueId}{p.decision ? ` · ${p.decision}` : ""}</p>
        <h1 className="mt-1 text-3xl font-bold leading-tight tracking-tight">{p.title}</h1>
        <p className="mt-2 text-sm text-zinc-600">{p.authors.join(", ")}</p>
        <div className="mt-3 flex items-center gap-3 text-sm">
          {p.openreviewUrl && <LinkBadge href={p.openreviewUrl} />}
          {p.pdfUrl && (
            <a className="text-blue-600 hover:underline" href={p.pdfUrl} target="_blank" rel="noreferrer">PDF ↗</a>
          )}
          <span className="ml-auto flex items-center gap-2">
            <CopyForAi
              paper={{
                id: p.id,
                title: p.title,
                titleZh: p.titleZh,
                authors: p.authors,
                venueId: p.venueId,
                decision: p.decision,
                abstract: p.abstract,
                abstractZh: p.abstractZh,
                openreviewUrl: p.openreviewUrl,
                pdfUrl: p.pdfUrl,
              }}
            />
            <MarkButtons paperId={p.id} initial={{ liked: !!mark?.liked, later: !!mark?.later }} />
            <KhojButton paperId={p.id} />
          </span>
        </div>
      </header>

      <section>
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-zinc-500">My notes</h2>
        <NoteEditor paperId={p.id} initial={mark?.note ?? ""} />
      </section>

      {p.aiOneliner && (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          {p.aiOneliner}
        </div>
      )}

      {p.aiSummaryV1 && (
        <section>
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-zinc-500">AI 总结</h2>
          <MarkdownView source={p.aiSummaryV1} />
        </section>
      )}

      <section>
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-zinc-500">Abstract</h2>
        <p className="whitespace-pre-line text-[15px] leading-relaxed text-zinc-800">{p.abstract}</p>
      </section>

      {p.abstractZh && (
        <section>
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-zinc-500">摘要（中文）</h2>
          <p className="whitespace-pre-line text-[15px] leading-relaxed text-zinc-800">{p.abstractZh}</p>
        </section>
      )}

      <AiChatPanel paperId={p.id} hasPdf={!!p.pdfUrl} />

      {p.aiSummary && (
        <section>
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-zinc-500">AI summary</h2>
          <div className="whitespace-pre-line text-[15px] leading-relaxed text-zinc-800">{p.aiSummary}</div>
        </section>
      )}

      {p.aiDeepAnalysis ? (
        <section>
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-zinc-500">深度解读</h2>
          <div className="whitespace-pre-line text-[15px] leading-relaxed text-zinc-800">{p.aiDeepAnalysis}</div>
        </section>
      ) : (mark?.liked || mark?.later) && p.pdfUrl ? (
        <section>
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-zinc-500">深度解读</h2>
          <p className="text-sm text-zinc-500">AI 深度解读生成中，稍后刷新本页查看。</p>
        </section>
      ) : null}

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">Keywords</h2>
        <div className="flex flex-wrap gap-1.5">
          {p.keywords.map((k) => (
            <Link
              key={k}
              href={`/k/${slug(k)}`}
              className="rounded bg-zinc-100 px-2 py-0.5 text-sm text-zinc-700 hover:bg-zinc-200"
            >
              {k}
            </Link>
          ))}
        </div>
      </section>

      <section className="text-sm text-zinc-600">
        {p.avgRating != null && (
          <p>
            Average rating: <strong>{p.avgRating.toFixed(2)}</strong>
            {p.stdRating != null && <> · std {p.stdRating.toFixed(2)}</>}
            {" "}({p.numReviews} reviews)
          </p>
        )}
      </section>
    </article>
  );
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function LinkBadge({ href }: { href: string }) {
  let host = "";
  try { host = new URL(href).hostname.replace(/^www\./, ""); } catch {}
  const label =
    host.includes("openreview.net") ? "OpenReview"
    : host.includes("arxiv.org") ? "arXiv"
    : host.includes("doi.org") ? "DOI"
    : host.endsWith("acm.org") ? "ACM"
    : host.endsWith("vldb.org") ? "PVLDB"
    : host ? host
    : "Source";
  return (
    <a className="text-blue-600 hover:underline" href={href} target="_blank" rel="noreferrer">
      {label} ↗
    </a>
  );
}
