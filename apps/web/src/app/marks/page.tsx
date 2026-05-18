import { db } from "@tcr/db";
import { marks, papers } from "@tcr/db/schema";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { PaperRow } from "@/components/paper-row";
import { KhojBatchBar } from "@/components/khoj-batch-bar";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

type Tab = "liked" | "later" | "viewed";

export default async function MarksPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const active: Tab =
    tab === "later" ? "later" : tab === "viewed" ? "viewed" : "liked";
  const { id: userId } = await requireUser();

  const filter =
    active === "liked"
      ? eq(marks.liked, true)
      : active === "later"
        ? eq(marks.later, true)
        : isNotNull(marks.viewedAt);
  const orderBy = active === "viewed" ? desc(marks.viewedAt) : desc(marks.updatedAt);

  const rows = await db
    .select({
      id: papers.id,
      title: papers.title,
      titleZh: papers.titleZh,
      authors: papers.authors,
      decision: papers.decision,
      interestScore: papers.interestScore,
      abstractTeaser: sql<string | null>`left(coalesce(${papers.abstractZh}, ${papers.abstract}), 220)`,
      aiSummaryV1Teaser: sql<string | null>`left(${papers.aiSummaryV1}, 600)`,
      openreviewUrl: papers.openreviewUrl,
      pdfUrl: papers.pdfUrl,
      liked: marks.liked,
      later: marks.later,
      viewedAt: sql<string | null>`${marks.viewedAt}::text`,
    })
    .from(marks)
    .innerJoin(papers, eq(marks.paperId, papers.id))
    .where(and(eq(marks.userId, userId), filter))
    .orderBy(orderBy)
    .limit(active === "viewed" ? 100 : 500);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Saved</h1>
        <div className="mt-2 flex gap-1 text-sm">
          <TabLink href="/marks?tab=liked" active={active === "liked"} label="♥ Liked" />
          <TabLink href="/marks?tab=later" active={active === "later"} label="★ Read later" />
          <TabLink href="/marks?tab=viewed" active={active === "viewed"} label="✓ Recently viewed" />
        </div>
        {(active === "liked" || active === "later") && rows.length > 0 && (
          <div className="mt-3">
            <div className="flex flex-wrap items-center gap-3">
              <KhojBatchBar
                tab={active}
                count={rows.length}
                khojBaseUrl={process.env.KHOJ_BASE_URL ?? "http://localhost:42110"}
              />
            </div>
          </div>
        )}
      </header>
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500">
          {active === "viewed"
            ? "Open any paper from a venue or keyword page — it'll appear here."
            : `Nothing here yet. Tap the ${active === "liked" ? "♡" : "☆"} icon on any paper to save it.`}
        </p>
      ) : (
        <ul>
          {rows.map((p) => <PaperRow key={p.id} p={p as any} />)}
        </ul>
      )}
    </div>
  );
}

function TabLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <a
      href={href}
      className={`rounded-md px-3 py-1.5 ${active ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"}`}
    >
      {label}
    </a>
  );
}
