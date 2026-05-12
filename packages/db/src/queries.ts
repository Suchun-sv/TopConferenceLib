import { and, desc, eq, ilike, inArray, ne, sql } from "drizzle-orm";
import { db } from "./index";
import { keywords, marks, paperKeywords, papers, venues } from "./schema";

const USER = "me";

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

export async function topKeywords(limit = 200, excludePrimaryArea = true) {
  // Filter out OpenReview primary_area entries — they're track names, not topics.
  // We detect them by checking if every link has source='primary_area'.
  if (excludePrimaryArea) {
    return db.execute(sql`
      select k.id, k.label, k.paper_count as "paperCount", k.recent_count as "recentCount"
      from keywords k
      where exists (
        select 1 from paper_keywords pk where pk.keyword_id = k.id and pk.source != 'primary_area'
      )
      order by k.paper_count desc
      limit ${limit}
    `).then((r: any) => r.rows ?? r);
  }
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

/** Sectioned listing for a venue: grouped by primary_area, alphabetical sections.
 *  Within section, ordered by decision tier (oral → spotlight → poster), then interest_score. */
export async function listPapersForVenueSectioned(venueId: string) {
  const rows: any = await db.execute(sql`
    select
      p.id, p.title, p.title_zh as "titleZh", p.authors, p.decision,
      p.interest_score as "interestScore",
      p.openreview_url as "openreviewUrl", p.pdf_url as "pdfUrl",
      coalesce(p.primary_area, '(uncategorized)') as "primaryArea",
      coalesce(m.liked, false) as liked,
      coalesce(m.later, false) as later
    from papers p
    left join marks m on m.paper_id = p.id and m.user_id = ${USER}
    where p.venue_id = ${venueId}
      and (m.hidden is null or m.hidden = false)
    order by
      coalesce(p.primary_area, 'zzz') asc,
      case p.decision
        when 'accept-oral' then 1
        when 'accept-spotlight' then 2
        when 'accept-poster' then 3
        when 'accept' then 3
        else 9 end asc,
      p.interest_score desc nulls last,
      p.title asc
  `).then((r: any) => r.rows ?? r);
  return rows as Array<{
    id: string; title: string; titleZh: string | null;
    authors: string[]; decision: string | null;
    interestScore: number | null;
    openreviewUrl: string | null; pdfUrl: string | null;
    primaryArea: string;
    liked: boolean; later: boolean;
  }>;
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
