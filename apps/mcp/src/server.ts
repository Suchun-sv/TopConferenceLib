#!/usr/bin/env node
/**
 * Top-Conference-Reading MCP server.
 *
 * Default transport: HTTP (streamable) on :8765 so it works from docker-compose
 * or alongside a remote agent. Set `--transport stdio` for desktop clients.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { z } from "zod";

import { db } from "@tcr/db";
import { jobs, keywords, marks, papers, venues } from "@tcr/db/schema";
import {
  getPaper,
  listPapers,
  listVenues,
  setMark,
  topKeywords,
} from "@tcr/db/queries";
import { and, desc, eq, sql } from "drizzle-orm";

const USER = "me";

function buildServer(): McpServer {
  const mcp = new McpServer(
    { name: "top-conference-reading", version: "0.1.0" },
    {
      instructions:
        "Browse and curate papers from ICLR / ICML / NeurIPS by research direction.\n" +
        "Typical flow:\n" +
        "  list_keywords → list_papers({keywordId}) → get_paper → mark_paper(liked)\n" +
        "  trigger_crawl({conference, year}) to ingest a new venue\n" +
        "  trigger_summarize({paperId}) to enqueue an AI summary",
    },
  );

  mcp.tool(
    "list_keywords",
    "Top keywords across all ingested papers. The size of each keyword drives the home-page word cloud.",
    { limit: z.number().int().min(1).max(1000).default(200) },
    async ({ limit }) => ({
      content: [{ type: "text", text: JSON.stringify(await topKeywords(limit), null, 2) }],
    }),
  );

  mcp.tool(
    "list_venues",
    "All ingested conference venues (e.g. ICLR 2025, NeurIPS 2024) with paper counts.",
    {},
    async () => ({
      content: [{ type: "text", text: JSON.stringify(await listVenues(), null, 2) }],
    }),
  );

  mcp.tool(
    "list_papers",
    "List papers, optionally filtered by venue / keyword / decision / rating, sorted by rating/recency/controversy.",
    {
      venueId: z.string().optional(),
      keywordId: z.string().optional(),
      decision: z.string().optional(),
      minRating: z.number().optional(),
      search: z.string().optional(),
      limit: z.number().int().min(1).max(200).default(20),
      offset: z.number().int().min(0).default(0),
      sort: z.enum(["rating-desc", "rating-asc", "recent", "controversial"]).default("rating-desc"),
    },
    async (input) => ({
      content: [{ type: "text", text: JSON.stringify(await listPapers(input), null, 2) }],
    }),
  );

  mcp.tool(
    "get_paper",
    "Full record for one paper, including abstract, scores, and AI summary if cached.",
    { id: z.string() },
    async ({ id }) => {
      const p = await getPaper(id);
      return { content: [{ type: "text", text: JSON.stringify(p, null, 2) }] };
    },
  );

  mcp.tool(
    "mark_paper",
    "Record a verdict on a paper. Multiple flags can be set in one call.",
    {
      id: z.string(),
      liked: z.boolean().optional(),
      later: z.boolean().optional(),
      hidden: z.boolean().optional(),
      note: z.string().optional(),
    },
    async ({ id, ...patch }) => {
      await setMark(USER, id, patch);
      return { content: [{ type: "text", text: `marked ${id} ${JSON.stringify(patch)}` }] };
    },
  );

  mcp.tool(
    "list_marks",
    "List papers the user has marked. Filter by liked / later / hidden.",
    {
      liked: z.boolean().optional(),
      later: z.boolean().optional(),
      hidden: z.boolean().optional(),
      limit: z.number().int().min(1).max(500).default(100),
    },
    async ({ liked, later, hidden, limit }) => {
      const conds = [eq(marks.userId, USER)];
      if (liked !== undefined) conds.push(eq(marks.liked, liked));
      if (later !== undefined) conds.push(eq(marks.later, later));
      if (hidden !== undefined) conds.push(eq(marks.hidden, hidden));
      const rows = await db
        .select()
        .from(marks)
        .where(and(...conds))
        .orderBy(desc(marks.updatedAt))
        .limit(limit);
      return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
    },
  );

  // ----- write / enqueue tools -----

  mcp.tool(
    "trigger_crawl",
    "Enqueue an OpenReview crawl for a (conference, year). Returns a job_id.",
    {
      conference: z.enum(["ICLR", "ICML", "NeurIPS"]),
      year: z.number().int().min(2018).max(2030),
      maxPapers: z.number().int().min(1).max(20000).optional(),
    },
    async (payload) => {
      const id = randomUUID();
      await db.insert(jobs).values({ id, kind: "crawl", status: "queued", payload });
      return { content: [{ type: "text", text: JSON.stringify({ jobId: id, status: "queued" }) }] };
    },
  );

  mcp.tool(
    "trigger_summarize",
    "Enqueue an AI summary job for one or more papers. Returns the job_id.",
    {
      paperIds: z.array(z.string()).min(1).max(50),
      style: z.enum(["oneliner", "summary", "both"]).default("both"),
    },
    async (payload) => {
      const id = randomUUID();
      await db.insert(jobs).values({ id, kind: "summarize", status: "queued", payload });
      return { content: [{ type: "text", text: JSON.stringify({ jobId: id, status: "queued" }) }] };
    },
  );

  mcp.tool(
    "trigger_extract_keywords",
    "Re-extract keywords for a venue (uses LLM + OpenReview keyword field).",
    { venueId: z.string() },
    async (payload) => {
      const id = randomUUID();
      await db.insert(jobs).values({ id, kind: "extract_keywords", status: "queued", payload });
      return { content: [{ type: "text", text: JSON.stringify({ jobId: id, status: "queued" }) }] };
    },
  );

  mcp.tool(
    "job_status",
    "Poll a background job by id.",
    { jobId: z.string() },
    async ({ jobId }) => {
      const row = (await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1))[0];
      return { content: [{ type: "text", text: JSON.stringify(row ?? null, null, 2) }] };
    },
  );

  mcp.tool(
    "save_to_zotero",
    "Push a paper into the configured Zotero library. Requires ZOTERO_API_KEY / ZOTERO_LIBRARY_ID in env.",
    {
      paperId: z.string(),
      collectionKey: z.string().optional(),
      tags: z.array(z.string()).optional(),
    },
    async ({ paperId, collectionKey, tags }) => {
      const apiKey = process.env.ZOTERO_API_KEY;
      const libId = process.env.ZOTERO_LIBRARY_ID;
      const libType = process.env.ZOTERO_LIBRARY_TYPE ?? "users";
      if (!apiKey || !libId) {
        return {
          content: [{
            type: "text",
            text: "Zotero not configured. Set ZOTERO_API_KEY and ZOTERO_LIBRARY_ID in .env.",
          }],
          isError: true,
        };
      }
      const p = await getPaper(paperId);
      if (!p) return { content: [{ type: "text", text: `paper ${paperId} not found` }], isError: true };

      const item: Record<string, any> = {
        itemType: "preprint",
        title: p.title,
        abstractNote: p.abstract ?? "",
        creators: (p.authors ?? []).map((name) => {
          const parts = name.trim().split(/\s+/);
          if (parts.length >= 2) {
            return { creatorType: "author", firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
          }
          return { creatorType: "author", name };
        }),
        url: p.pdfUrl ?? p.openreviewUrl ?? "",
        tags: [...(p.keywords ?? []), ...(tags ?? [])].map((t) => ({ tag: t })),
        extra: `Venue: ${p.venueId}${p.decision ? ` (${p.decision})` : ""}`,
      };
      if (collectionKey) item.collections = [collectionKey];

      const r = await fetch(`https://api.zotero.org/${libType}/${libId}/items`, {
        method: "POST",
        headers: { "Zotero-API-Key": apiKey, "content-type": "application/json" },
        body: JSON.stringify([item]),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        return { content: [{ type: "text", text: `Zotero error ${r.status}: ${JSON.stringify(data)}` }], isError: true };
      }
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    },
  );

  return mcp;
}

async function main() {
  const transport = (process.env.MCP_TRANSPORT ?? "http") as "http" | "stdio";
  const mcp = buildServer();

  if (transport === "stdio") {
    const t = new StdioServerTransport();
    await mcp.connect(t);
    process.stderr.write("MCP server ready on stdio\n");
    return;
  }

  // HTTP / streamable transport.
  const host = process.env.MCP_HOST ?? "0.0.0.0";
  const port = Number(process.env.MCP_PORT ?? 8765);
  const httpTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  await mcp.connect(httpTransport);

  const server = createServer(async (req, res) => {
    if (req.url && req.url.startsWith("/mcp")) {
      await httpTransport.handleRequest(req as any, res as any);
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });
  server.listen(port, host, () => {
    console.log(`MCP server listening on http://${host}:${port}/mcp`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
