# top-conference-reading

Browse ICLR / ICML / NeurIPS papers **by research direction**, not by chronological scroll.
The landing page is a keyword cloud — click a direction, see papers ranked by review score.

Built as a TypeScript-first monorepo with a Python sidecar for crawling and LLM work:

```
apps/
  web/          Next.js 15 (App Router, RSC) + Tailwind + shadcn/ui
  mcp/          @modelcontextprotocol/sdk server (HTTP+stdio)
packages/
  db/           Drizzle schema + queries (shared by web + mcp)
workers/
  crawler/      Python: OpenReview crawler + LiteLLM summarizer
docker-compose.yaml   (optional) self-hosted Postgres+web+mcp+crawler
```

## Quick start

### 1. Database

Either:

- **Neon (recommended for free hosting):** create a project at https://neon.tech, copy the
  pooled connection string, paste into `.env` as `DATABASE_URL`.
- **Local Postgres via docker compose:** `docker compose up -d postgres`.

### 2. Install + push schema

```bash
cp .env.example .env
pnpm install
pnpm db:push
```

### 3. Run dev servers

```bash
# terminal 1 — Next.js
pnpm dev                     # → http://localhost:3000

# terminal 2 — MCP server
pnpm dev:mcp                 # → http://127.0.0.1:8765/mcp/

# terminal 3 — ingest a venue
pnpm crawl crawl ICLR 2025
```

## MCP

Wire into Claude Desktop / Claude Code:

```jsonc
{ "mcpServers": { "tcr": { "url": "http://127.0.0.1:8765/mcp/" } } }
```

Tools exposed:

| Tool | What it does |
|---|---|
| `list_keywords` | Top keywords (drives the home cloud) |
| `list_venues` | Conference-years with paper counts |
| `list_papers` | Filter by venue / keyword / decision / rating; sort by rating / recency / controversy |
| `get_paper` | Full record incl. AI summary if cached |
| `mark_paper` | liked / later / hidden / note |
| `list_marks` | Read marks back |
| `trigger_crawl` | Enqueue an OpenReview ingestion for `(conference, year)` |
| `trigger_summarize` | Enqueue AI oneliner+summary for paper ids |
| `trigger_extract_keywords` | Re-link keywords for a venue |
| `job_status` | Poll a background job |
| `save_to_zotero` | Push a paper to Zotero (needs `ZOTERO_API_KEY` + `ZOTERO_LIBRARY_ID`) |

Typical agent prompt:

> *"Show me trending directions in ICLR 2025. Pick three controversial papers per
> direction and save the most interesting one to my Zotero 'reading' collection."*

## Deploy

### Vercel + Neon (free)

1. Push the repo to GitHub.
2. Connect to Vercel, root = repo root, framework = Next.js, build command = `pnpm --filter web build`.
3. Add `DATABASE_URL` (Neon pooled string), `OPENAI_API_KEY`, optionally Zotero keys.
4. The crawler/MCP do **not** run on Vercel — host them on your own box (see compose) or a
   small Fly.io VM. The web app talks to the same Neon DB.

### Self-hosted (docker compose)

```bash
cp .env.example .env
docker compose up --build
# web → :3000   MCP → 127.0.0.1:8765
```

## Status

v0.1: scaffold + schema + crawler skeleton. Not yet runnable end-to-end without
filling in API keys and running `pnpm db:push`.
