import { and, desc, eq, ilike, inArray, ne, sql } from "drizzle-orm";
import { db } from "./index";
import { randomUUID } from "node:crypto";
import { jobs, keywords, khojExports, marks, paperKeywords, papers, venueBookmarks, venues } from "./schema";

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

export async function listPapers(f: ListFilter = {}, userId?: string) {
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

  const uid = userId ?? "";
  return db
    .select({
      id: papers.id,
      title: papers.title,
      titleZh: papers.titleZh,
      authors: papers.authors,
      venueId: papers.venueId,
      decision: papers.decision,
      avgRating: papers.avgRating,
      stdRating: papers.stdRating,
      keywords: papers.keywords,
      aiOneliner: papers.aiOneliner,
      abstractTeaser: sql<string | null>`left(coalesce(${papers.abstractZh}, ${papers.abstract}), 220)`,
      aiSummaryV1Teaser: sql<string | null>`left(${papers.aiSummaryV1}, 600)`,
      liked: sql<boolean>`coalesce(${marks.liked}, false)`,
      later: sql<boolean>`coalesce(${marks.later}, false)`,
      viewedAt: marks.viewedAt,
    })
    .from(papers)
    .leftJoin(
      marks,
      and(eq(marks.paperId, papers.id), eq(marks.userId, uid)),
    )
    .where(where as any)
    .orderBy(orderBy)
    .limit(f.limit ?? 20)
    .offset(f.offset ?? 0);
}

export async function getPaper(id: string) {
  const rows = await db.select().from(papers).where(eq(papers.id, id)).limit(1);
  return rows[0] ?? null;
}

export type KeywordRow = {
  id: string;
  label: string;
  paperCount: number;
  recentCount: number;
};

export async function topKeywords(limit = 200, excludePrimaryArea = true): Promise<KeywordRow[]> {
  // Filter out OpenReview primary_area entries — they're track names, not topics.
  if (excludePrimaryArea) {
    const r: any = await db.execute(sql`
      select k.id, k.label, k.paper_count as "paperCount", k.recent_count as "recentCount"
      from keywords k
      where exists (
        select 1 from paper_keywords pk where pk.keyword_id = k.id and pk.source != 'primary_area'
      )
      order by k.paper_count desc
      limit ${limit}
    `);
    return (r.rows ?? r) as KeywordRow[];
  }
  const rows = await db
    .select({
      id: keywords.id,
      label: keywords.label,
      paperCount: keywords.paperCount,
      recentCount: keywords.recentCount,
    })
    .from(keywords)
    .orderBy(desc(keywords.paperCount))
    .limit(limit);
  return rows as KeywordRow[];
}

/** Sectioned listing for a venue: grouped by primary_area, alphabetical sections.
 *  Within section, ordered by decision tier (oral → spotlight → poster), then interest_score. */
export async function listPapersForVenueSectioned(venueId: string, userId: string) {
  const rows: any = await db.execute(sql`
    select
      p.id, p.title, p.title_zh as "titleZh", p.authors, p.decision,
      p.interest_score as "interestScore",
      left(coalesce(p.abstract_zh, p.abstract), 220) as "abstractTeaser",
      left(p.ai_summary_v1, 600) as "aiSummaryV1Teaser",
      p.openreview_url as "openreviewUrl", p.pdf_url as "pdfUrl",
      coalesce(p.primary_area, '(uncategorized)') as "primaryArea",
      coalesce(m.liked, false) as liked,
      coalesce(m.later, false) as later,
      m.viewed_at as "viewedAt",
      b.label as "bookmarkLabel",
      (b.paper_id is not null) as bookmarked
    from papers p
    left join marks m on m.paper_id = p.id and m.user_id = ${userId}
    left join venue_bookmarks b on b.paper_id = p.id and b.user_id = ${userId} and b.venue_id = ${venueId}
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
    abstractTeaser: string | null;
    aiSummaryV1Teaser: string | null;
    openreviewUrl: string | null; pdfUrl: string | null;
    primaryArea: string;
    liked: boolean; later: boolean;
    viewedAt: string | null;
    bookmarked: boolean; bookmarkLabel: string | null;
  }>;
}

// ---------- venue bookmarks ----------

export async function listBookmarks(userId: string, venueId: string) {
  return db
    .select({
      paperId: venueBookmarks.paperId,
      label: venueBookmarks.label,
      createdAt: venueBookmarks.createdAt,
      title: papers.title,
      titleZh: papers.titleZh,
    })
    .from(venueBookmarks)
    .innerJoin(papers, eq(papers.id, venueBookmarks.paperId))
    .where(and(eq(venueBookmarks.userId, userId), eq(venueBookmarks.venueId, venueId)))
    .orderBy(desc(venueBookmarks.createdAt));
}

export async function upsertBookmark(
  userId: string,
  venueId: string,
  paperId: string,
  label: string | null,
) {
  await db
    .insert(venueBookmarks)
    .values({ userId, venueId, paperId, label })
    .onConflictDoUpdate({
      target: [venueBookmarks.userId, venueBookmarks.venueId, venueBookmarks.paperId],
      set: { label },
    });
}

// ---------- khoj export ----------

export async function listMarkedPaperIds(userId: string, tab: "liked" | "later") {
  const rows = await db
    .select({ id: marks.paperId })
    .from(marks)
    .where(
      and(
        eq(marks.userId, userId),
        tab === "liked" ? eq(marks.liked, true) : eq(marks.later, true),
      ),
    );
  return rows.map((r) => r.id);
}

export async function khojExportStatus(
  paperIds: string[],
): Promise<Record<string, string>> {
  if (paperIds.length === 0) return {};
  const rows = await db
    .select({ paperId: khojExports.paperId, status: khojExports.status })
    .from(khojExports)
    .where(inArray(khojExports.paperId, paperIds));
  const out: Record<string, string> = {};
  for (const r of rows) out[r.paperId] = r.status;
  return out;
}

/** Enqueue export jobs, skipping papers already done or with an open job. */
export async function enqueueKhojExports(
  paperIds: string[],
  requestedBy: string,
  force = false,
): Promise<{ queued: number; skipped: number }> {
  if (paperIds.length === 0) return { queued: 0, skipped: 0 };

  // Already-done exports (unless force).
  const doneSet = new Set<string>();
  if (!force) {
    const done = await db
      .select({ id: khojExports.paperId })
      .from(khojExports)
      .where(and(inArray(khojExports.paperId, paperIds), eq(khojExports.status, "done")));
    for (const r of done) doneSet.add(r.id);
  }

  // Papers with an open (queued/running) khoj_export job.
  const openRows = await db
    .select({ payload: jobs.payload })
    .from(jobs)
    .where(
      and(
        eq(jobs.kind, "khoj_export"),
        inArray(jobs.status, ["queued", "running"]),
      ),
    );
  const openSet = new Set<string>();
  for (const r of openRows) {
    const pid = (r.payload as any)?.paperId;
    if (typeof pid === "string") openSet.add(pid);
  }

  let queued = 0;
  let skipped = 0;
  for (const pid of paperIds) {
    if (doneSet.has(pid) || openSet.has(pid)) {
      skipped++;
      continue;
    }
    await db
      .insert(khojExports)
      .values({ paperId: pid, requestedBy, status: "pending" })
      .onConflictDoUpdate({
        target: khojExports.paperId,
        set: { status: "pending", requestedBy, error: null },
      });
    await db.insert(jobs).values({
      id: randomUUID(),
      kind: "khoj_export",
      status: "queued",
      payload: { paperId: pid, requestedBy },
    });
    queued++;
  }
  return { queued, skipped };
}

export async function deleteBookmark(userId: string, venueId: string, paperId: string) {
  await db
    .delete(venueBookmarks)
    .where(
      and(
        eq(venueBookmarks.userId, userId),
        eq(venueBookmarks.venueId, venueId),
        eq(venueBookmarks.paperId, paperId),
      ),
    );
}

export async function listVenues() {
  return db
    .select()
    .from(venues)
    .orderBy(desc(venues.year), venues.conference);
}

export async function getMark(userId: string, paperId: string) {
  const rows = await db
    .select()
    .from(marks)
    .where(and(eq(marks.userId, userId), eq(marks.paperId, paperId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Stamp the first-view time. Preserves the original viewed_at on repeat opens. */
export async function markViewed(userId: string, paperId: string) {
  await db
    .insert(marks)
    .values({ userId, paperId, viewedAt: sql`now()` })
    .onConflictDoUpdate({
      target: [marks.userId, marks.paperId],
      set: { viewedAt: sql`coalesce(marks.viewed_at, now())` },
    });
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
