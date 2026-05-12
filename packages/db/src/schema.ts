import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

/** A conference instance: "ICLR 2025", "NeurIPS 2024", etc. */
export const venues = pgTable(
  "venues",
  {
    id: text("id").primaryKey(), // e.g. "iclr-2025"
    conference: varchar("conference", { length: 32 }).notNull(), // "ICLR" | "ICML" | "NeurIPS" | ...
    year: integer("year").notNull(),
    openreviewId: text("openreview_id"), // "ICLR.cc/2025/Conference"
    paperCount: integer("paper_count").default(0).notNull(),
    crawledAt: timestamp("crawled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("venues_conference_year_idx").on(t.conference, t.year),
  ],
);

/** Decision / acceptance status emitted by OpenReview. */
export type Decision = "accept-oral" | "accept-spotlight" | "accept-poster" | "accept" | "reject" | "withdrawn" | null;

export const papers = pgTable(
  "papers",
  {
    id: text("id").primaryKey(), // openreview forum id, fallback hash
    venueId: text("venue_id").notNull().references(() => venues.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    abstract: text("abstract"),
    authors: jsonb("authors").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
    affiliations: jsonb("affiliations").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
    pdfUrl: text("pdf_url"),
    openreviewUrl: text("openreview_url"),

    /** Author-supplied keywords (from OpenReview). Primary source for the cloud. */
    keywords: jsonb("keywords").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
    /** OpenReview's "primary_area" / track. */
    primaryArea: text("primary_area"),

    decision: text("decision").$type<Decision>(),
    avgRating: real("avg_rating"),
    stdRating: real("std_rating"),
    numReviews: integer("num_reviews").default(0).notNull(),

    /** AI-generated. */
    aiSummary: text("ai_summary"),
    aiOneliner: text("ai_oneliner"),
    aiTopics: jsonb("ai_topics").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
    titleZh: text("title_zh"),
    /** LLM-rated novelty / interest, 1-5. Null = not scored yet. */
    interestScore: real("interest_score"),

    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("papers_venue_idx").on(t.venueId),
    index("papers_avg_rating_idx").on(t.avgRating),
    index("papers_decision_idx").on(t.decision),
  ],
);

/** Canonical keyword (normalized). Drives the word cloud. */
export const keywords = pgTable(
  "keywords",
  {
    id: text("id").primaryKey(), // slug, e.g. "retrieval-augmented-generation"
    label: text("label").notNull(), // display form, e.g. "Retrieval-Augmented Generation"
    paperCount: integer("paper_count").default(0).notNull(),
    /** rolling-window count for "trending" sizing. */
    recentCount: integer("recent_count").default(0).notNull(),
  },
  (t) => [
    index("keywords_paper_count_idx").on(t.paperCount),
  ],
);

export const paperKeywords = pgTable(
  "paper_keywords",
  {
    paperId: text("paper_id").notNull().references(() => papers.id, { onDelete: "cascade" }),
    keywordId: text("keyword_id").notNull().references(() => keywords.id, { onDelete: "cascade" }),
    /** "author" = author-supplied, "ai" = ai-extracted, "primary_area" = openreview area. */
    source: varchar("source", { length: 16 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.paperId, t.keywordId, t.source] }),
    index("pk_keyword_idx").on(t.keywordId),
  ],
);

export const reviews = pgTable(
  "reviews",
  {
    id: text("id").primaryKey(), // openreview note id
    paperId: text("paper_id").notNull().references(() => papers.id, { onDelete: "cascade" }),
    reviewerAnon: text("reviewer_anon"), // e.g. "Reviewer_abcd"
    rating: integer("rating"),
    confidence: integer("confidence"),
    summary: text("summary"),
    strengths: text("strengths"),
    weaknesses: text("weaknesses"),
    rawContent: jsonb("raw_content"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("reviews_paper_idx").on(t.paperId),
  ],
);

/** Agent / user marks. Single-user model for now (user_id="me"). */
export const marks = pgTable(
  "marks",
  {
    userId: text("user_id").notNull(),
    paperId: text("paper_id").notNull().references(() => papers.id, { onDelete: "cascade" }),
    liked: boolean("liked").default(false).notNull(),
    later: boolean("later").default(false).notNull(),
    hidden: boolean("hidden").default(false).notNull(),
    note: text("note"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.paperId] }),
  ],
);

/** Background jobs the MCP can enqueue and poll. */
export const jobs = pgTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    kind: varchar("kind", { length: 32 }).notNull(), // "crawl" | "summarize" | "extract_keywords"
    status: varchar("status", { length: 16 }).default("queued").notNull(), // queued|running|done|failed
    payload: jsonb("payload"),
    result: jsonb("result"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("jobs_status_idx").on(t.status)],
);

// ---------- Relations ----------

export const venuesRel = relations(venues, ({ many }) => ({
  papers: many(papers),
}));

export const papersRel = relations(papers, ({ one, many }) => ({
  venue: one(venues, { fields: [papers.venueId], references: [venues.id] }),
  paperKeywords: many(paperKeywords),
  reviews: many(reviews),
}));

export const keywordsRel = relations(keywords, ({ many }) => ({
  paperKeywords: many(paperKeywords),
}));

export const paperKeywordsRel = relations(paperKeywords, ({ one }) => ({
  paper: one(papers, { fields: [paperKeywords.paperId], references: [papers.id] }),
  keyword: one(keywords, { fields: [paperKeywords.keywordId], references: [keywords.id] }),
}));
