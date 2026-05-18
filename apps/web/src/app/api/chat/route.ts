import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@tcr/db";
import { papers } from "@tcr/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatMessage = { role: "user" | "assistant"; content: string };
type ChatBody = {
  paperId: string;
  messages: ChatMessage[];
  provider: "openai" | "anthropic" | "custom";
  apiKey: string;
  model: string;
  baseUrl?: string;
};

const MAX_CONTEXT_CHARS = 200_000; // hard ceiling on paper text we'll inject

export async function POST(req: NextRequest) {
  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return new Response("invalid json", { status: 400 });
  }
  if (!body.apiKey) return new Response("apiKey required", { status: 400 });
  if (!body.model) return new Response("model required", { status: 400 });
  if (!body.paperId) return new Response("paperId required", { status: 400 });
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return new Response("messages required", { status: 400 });
  }

  const rows = await db
    .select({
      title: papers.title,
      authors: papers.authors,
      venueId: papers.venueId,
      decision: papers.decision,
      abstract: papers.abstract,
      fullText: papers.fullText,
    })
    .from(papers)
    .where(eq(papers.id, body.paperId))
    .limit(1);
  const p = rows[0];
  if (!p) return new Response("paper not found", { status: 404 });

  const context = buildContext(p);
  const system = buildSystem(context);

  try {
    if (body.provider === "anthropic") {
      return await streamAnthropic({ ...body, system });
    }
    return await streamOpenAICompatible({ ...body, system });
  } catch (e: any) {
    return new Response(`upstream error: ${e?.message ?? e}`, { status: 502 });
  }
}

function buildContext(p: {
  title: string;
  authors: string[];
  venueId: string;
  decision: string | null;
  abstract: string | null;
  fullText: string | null;
}): string {
  const parts = [
    `Title: ${p.title}`,
    `Authors: ${p.authors.join(", ")}`,
    `Venue: ${p.venueId}${p.decision ? ` (${p.decision})` : ""}`,
  ];
  if (p.abstract) parts.push(`\nAbstract:\n${p.abstract}`);
  if (p.fullText) {
    let body = p.fullText;
    if (body.length > MAX_CONTEXT_CHARS) {
      // Keep head + tail to preserve intro and conclusions / refs.
      const head = body.slice(0, Math.floor(MAX_CONTEXT_CHARS * 0.7));
      const tail = body.slice(-Math.floor(MAX_CONTEXT_CHARS * 0.3));
      body = `${head}\n\n[…truncated…]\n\n${tail}`;
    }
    parts.push(`\nFull text:\n${body}`);
  }
  return parts.join("\n");
}

function buildSystem(context: string): string {
  return (
    "You are a research assistant helping a graduate student understand an academic paper. " +
    "Answer questions strictly based on the paper below. If the paper does not contain the answer, say so. " +
    "Default to concise answers; expand when asked. Reply in the user's language. " +
    "When quoting, give a short verbatim quote from the paper.\n\n" +
    "===== PAPER START =====\n" +
    context +
    "\n===== PAPER END ====="
  );
}

// ---- providers ----

async function streamOpenAICompatible(opts: {
  baseUrl?: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  system: string;
}): Promise<Response> {
  const base = (opts.baseUrl || "https://api.openai.com").replace(/\/+$/, "");
  const url = base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
  const upstream = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      stream: true,
      messages: [{ role: "system", content: opts.system }, ...opts.messages],
    }),
  });
  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => "");
    return new Response(`upstream ${upstream.status}: ${errText.slice(0, 500)}`, {
      status: 502,
    });
  }
  return new Response(toTextStream(upstream.body, parseOpenAISSE), {
    headers: { "content-type": "text/plain; charset=utf-8", "x-accel-buffering": "no" },
  });
}

async function streamAnthropic(opts: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  system: string;
}): Promise<Response> {
  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": opts.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: 4096,
      stream: true,
      system: opts.system,
      messages: opts.messages,
    }),
  });
  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => "");
    return new Response(`upstream ${upstream.status}: ${errText.slice(0, 500)}`, {
      status: 502,
    });
  }
  return new Response(toTextStream(upstream.body, parseAnthropicSSE), {
    headers: { "content-type": "text/plain; charset=utf-8", "x-accel-buffering": "no" },
  });
}

// ---- streaming helpers: convert provider SSE → plain delta text ----

type Parser = (event: string) => string | null;

function toTextStream(body: ReadableStream<Uint8Array>, parse: Parser): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      const reader = body.getReader();
      let buf = "";
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx;
          // SSE events separated by blank line
          while ((idx = buf.indexOf("\n\n")) !== -1) {
            const event = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const delta = parse(event);
            if (delta) controller.enqueue(encoder.encode(delta));
          }
        }
        if (buf.trim()) {
          const delta = parse(buf);
          if (delta) controller.enqueue(encoder.encode(delta));
        }
      } catch (e) {
        controller.error(e);
        return;
      }
      controller.close();
    },
  });
}

function parseOpenAISSE(event: string): string | null {
  // Each event has one or more "data: …" lines.
  let out = "";
  for (const line of event.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (payload === "[DONE]") return out || null;
    try {
      const j = JSON.parse(payload);
      const piece = j?.choices?.[0]?.delta?.content;
      if (typeof piece === "string") out += piece;
    } catch {
      // ignore non-JSON keepalives
    }
  }
  return out || null;
}

function parseAnthropicSSE(event: string): string | null {
  let kind = "";
  let data = "";
  for (const line of event.split("\n")) {
    if (line.startsWith("event:")) kind = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!data || kind !== "content_block_delta") return null;
  try {
    const j = JSON.parse(data);
    const text = j?.delta?.text;
    return typeof text === "string" ? text : null;
  } catch {
    return null;
  }
}
