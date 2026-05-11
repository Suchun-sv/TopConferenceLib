import { and, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import { db } from "./index.js";
import { keywords, marks, paperKeywords, papers, venues } from "./schema.js";

export type ListFilter = {
  venueId?: string;
  keywordId?: string;
  decision?: string;
  minRating?: number;
  search?: string;
  limit?: number;
  offset?: number;
  sort?: "rating-desc" | "rating-asc" | "recent" | "controversial";
};

export async function listPapers(f: ListFilter = {}) {
  const conds = [] as any[];
  if (f.venueId) conds.push(eq(papers.venueId, f.venueId));
  if (f.decision) conds.push(eq(papers.decision, f.decision as any));
  if (typeof f.minRating === "number") conds.push(sql`${papers.avgRating} >= ${f.minRating}`);
  if (f.search) conds.push(ilike(papers.title, `%${f.search}%`));

  let where = conds.length ? and(...conds) : undefined;

  let baseIds: string[] | null = null;
  if (f.keywordId) {
    const rows = await db
      .select({ id: paperKeywords.paperId })
      .from(paperKeywords)
      .where(eq(paperKeywords.keywordId, f.keywordId));
    baseIds = rows.map((r) => r.id);
    if (baseIds.length === 0) return [];
    where = where ? and(where, inArray(papers.id, baseIds)) : inArray(papers.id, baseIds);
  }

  const orderBy =
    f.sort === "rating-asc" ? sql`${papers.avgRating} asc nulls last` :
    f.sort === "recent" ? desc(papers.publishedAt) :
    f.sort === "controversial" ? desc(papers.stdRating) :
    sql`${papers.avgRating} desc nulls last`;

  return db
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
    })
    .from(papers)
    .where(where as any)
    .orderBy(orderBy)
    .limit(f.limit ?? 20)
    .offset(f.offset ?? 0);
}

export async function getPaper(id: string) {
  const rows = await db.select().from(papers).where(eq(papers.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function topKeywords(limit = 200) {
  return db
    .select({
      id: keywords.id,
      label: keywords.label,
      paperCount: keywords.paperCount,
      recentCount: keywords.recentCount,
    })
    .from(keywords)
    .orderBy(desc(keywords.paperCount))
    .limit(limit);
}

export async function listVenues() {
  return db
    .select()
    .from(venues)
    .orderBy(desc(venues.year), venues.conference);
}

export async function setMark(
  userId: string,
  paperId: string,
  patch: { liked?: boolean; later?: boolean; hidden?: boolean; note?: string },
) {
  await db
    .insert(marks)
    .values({ userId, paperId, ...patch })
    .onConflictDoUpdate({
      target: [marks.userId, marks.paperId],
      set: { ...patch, updatedAt: sql`now()` },
    });
}
