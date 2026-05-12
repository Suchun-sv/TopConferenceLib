import { db } from "@tcr/db";
import { marks, papers } from "@tcr/db/schema";
import { and, desc, eq, or } from "drizzle-orm";
import { PaperRow } from "@/components/paper-row";

export const dynamic = "force-dynamic";

const USER = "me";

export default async function MarksPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const active = (tab === "later" ? "later" : "liked") as "liked" | "later";

  const rows = await db
    .select({
      id: papers.id,
      title: papers.title,
      titleZh: papers.titleZh,
      authors: papers.authors,
      decision: papers.decision,
      interestScore: papers.interestScore,
      openreviewUrl: papers.openreviewUrl,
      pdfUrl: papers.pdfUrl,
      liked: marks.liked,
      later: marks.later,
    })
    .from(marks)
    .innerJoin(papers, eq(marks.paperId, papers.id))
    .where(and(eq(marks.userId, USER), active === "liked" ? eq(marks.liked, true) : eq(marks.later, true)))
    .orderBy(desc(marks.updatedAt));

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Saved</h1>
        <div className="mt-2 flex gap-1 text-sm">
          <Tab href="/marks?tab=liked" active={active === "liked"} label="♥ Liked" />
          <Tab href="/marks?tab=later" active={active === "later"} label="★ Read later" />
        </div>
      </header>
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500">
          Nothing here yet. Tap the {active === "liked" ? "♡" : "☆"} icon on any paper to save it.
        </p>
      ) : (
        <ul>
          {rows.map((p) => <PaperRow key={p.id} p={p as any} />)}
        </ul>
      )}
    </div>
  );
}

function Tab({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <a
      href={href}
      className={`rounded-md px-3 py-1.5 ${active ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"}`}
    >
      {label}
    </a>
  );
}
