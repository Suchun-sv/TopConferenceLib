import { db } from "@tcr/db";
import { marks, papers } from "@tcr/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { PaperCard } from "@/components/paper-card";

export const dynamic = "force-dynamic";

export default async function MarksPage() {
  const rows = await db
    .select({
      id: papers.id,
      title: papers.title,
      authors: papers.authors,
      venueId: papers.venueId,
      decision: papers.decision,
      avgRating: papers.avgRating,
      stdRating: papers.stdRating,
      keywords: papers.keywords,
      aiOneliner: papers.aiOneliner,
      liked: marks.liked,
      later: marks.later,
    })
    .from(marks)
    .innerJoin(papers, eq(marks.paperId, papers.id))
    .where(and(eq(marks.userId, "me")))
    .orderBy(desc(marks.updatedAt));

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Saved papers</h1>
      {rows.length === 0 && (
        <p className="text-sm text-zinc-500">No saved papers yet. Ask the agent to mark a few.</p>
      )}
      <div className="grid gap-3">
        {rows.map((r) => <PaperCard key={r.id} p={r as any} />)}
      </div>
    </div>
  );
}
