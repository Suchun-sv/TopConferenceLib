CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" varchar(32) NOT NULL,
	"status" varchar(16) DEFAULT 'queued' NOT NULL,
	"payload" jsonb,
	"result" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "keywords" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"paper_count" integer DEFAULT 0 NOT NULL,
	"recent_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marks" (
	"user_id" text NOT NULL,
	"paper_id" text NOT NULL,
	"liked" boolean DEFAULT false NOT NULL,
	"later" boolean DEFAULT false NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marks_user_id_paper_id_pk" PRIMARY KEY("user_id","paper_id")
);
--> statement-breakpoint
CREATE TABLE "paper_keywords" (
	"paper_id" text NOT NULL,
	"keyword_id" text NOT NULL,
	"source" varchar(16) NOT NULL,
	CONSTRAINT "paper_keywords_paper_id_keyword_id_source_pk" PRIMARY KEY("paper_id","keyword_id","source")
);
--> statement-breakpoint
CREATE TABLE "papers" (
	"id" text PRIMARY KEY NOT NULL,
	"venue_id" text NOT NULL,
	"title" text NOT NULL,
	"abstract" text,
	"authors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"affiliations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pdf_url" text,
	"openreview_url" text,
	"keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"primary_area" text,
	"decision" text,
	"avg_rating" real,
	"std_rating" real,
	"num_reviews" integer DEFAULT 0 NOT NULL,
	"ai_summary" text,
	"ai_oneliner" text,
	"ai_topics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"paper_id" text NOT NULL,
	"reviewer_anon" text,
	"rating" integer,
	"confidence" integer,
	"summary" text,
	"strengths" text,
	"weaknesses" text,
	"raw_content" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" text PRIMARY KEY NOT NULL,
	"conference" varchar(32) NOT NULL,
	"year" integer NOT NULL,
	"openreview_id" text,
	"paper_count" integer DEFAULT 0 NOT NULL,
	"crawled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "marks" ADD CONSTRAINT "marks_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_keywords" ADD CONSTRAINT "paper_keywords_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_keywords" ADD CONSTRAINT "paper_keywords_keyword_id_keywords_id_fk" FOREIGN KEY ("keyword_id") REFERENCES "public"."keywords"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "papers" ADD CONSTRAINT "papers_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "keywords_paper_count_idx" ON "keywords" USING btree ("paper_count");--> statement-breakpoint
CREATE INDEX "pk_keyword_idx" ON "paper_keywords" USING btree ("keyword_id");--> statement-breakpoint
CREATE INDEX "papers_venue_idx" ON "papers" USING btree ("venue_id");--> statement-breakpoint
CREATE INDEX "papers_avg_rating_idx" ON "papers" USING btree ("avg_rating");--> statement-breakpoint
CREATE INDEX "papers_decision_idx" ON "papers" USING btree ("decision");--> statement-breakpoint
CREATE INDEX "reviews_paper_idx" ON "reviews" USING btree ("paper_id");--> statement-breakpoint
CREATE UNIQUE INDEX "venues_conference_year_idx" ON "venues" USING btree ("conference","year");