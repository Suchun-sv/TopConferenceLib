import { eq, sql } from "drizzle-orm";
import { db } from "@tcr/db";
import { papers } from "@tcr/db/schema";
import { ensureFullText } from "@/lib/pdf-text";

// Fixed read-through prompt, asked verbatim against the PDF whenever a user
// likes / saves a paper. Phrased from the POV of a PhD student new to the area.
const DEEP_ANALYSIS_PROMPT =
  "假设你是一个对这个方向不了解的博士生，请首先解释一下这个文章是什么方向，" +
  "其次告诉我这是什么单位的谁写的，最后详细的和我说这篇文章解决的是什么问题，怎么解决的。" +
  "请用中文回答，分点、清晰、详细。";

const MAX_CONTEXT_CHARS = 200_000; // same ceiling the chat route uses

function buildContext(p: {
  title: string;
  authors: string[];
  venueId: string;
  decision: string | null;
  abstract: string | null;
  fullText: string;
}): string {
  const parts = [
    `Title: ${p.title}`,
    `Authors: ${p.authors.join(", ")}`,
    `Venue: ${p.venueId}${p.decision ? ` (${p.decision})` : ""}`,
  ];
  if (p.abstract) parts.push(`\nAbstract:\n${p.abstract}`);
  let body = p.fullText;
  if (body.length > MAX_CONTEXT_CHARS) {
    const head = body.slice(0, Math.floor(MAX_CONTEXT_CHARS * 0.7));
    const tail = body.slice(-Math.floor(MAX_CONTEXT_CHARS * 0.3));
    body = `${head}\n\n[…truncated…]\n\n${tail}`;
  }
  parts.push(`\nFull text:\n${body}`);
  return parts.join("\n");
}

/**
 * Generate (once) a deep GPT read-through of a paper's PDF and cache it on
 * papers.ai_deep_analysis. Idempotent: returns early if already generated.
 * Never throws — callers (the like/save action) must not be blocked by it.
 */
export async function generateDeepAnalysis(paperId: string): Promise<void> {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("[deep-analysis] OPENAI_API_KEY not set; skipping", paperId);
      return;
    }
    const model = process.env.LLM_MODEL || "gpt-4o";

    const rows = await db
      .select({
        title: papers.title,
        authors: papers.authors,
        venueId: papers.venueId,
        decision: papers.decision,
        abstract: papers.abstract,
        aiDeepAnalysis: papers.aiDeepAnalysis,
      })
      .from(papers)
      .where(eq(papers.id, paperId))
      .limit(1);
    const p = rows[0];
    if (!p) return;
    if (p.aiDeepAnalysis && p.aiDeepAnalysis.length > 0) return; // cached

    const ft = await ensureFullText(paperId);
    if (!ft.ok) {
      console.error(`[deep-analysis] no text for ${paperId}: ${ft.error}`);
      return;
    }

    const context = buildContext({
      title: p.title,
      authors: p.authors,
      venueId: p.venueId,
      decision: p.decision,
      abstract: p.abstract,
      fullText: ft.text,
    });
    const system =
      "You are a research assistant helping a PhD student understand an academic paper. " +
      "Answer strictly based on the paper below.\n\n" +
      "===== PAPER START =====\n" +
      context +
      "\n===== PAPER END =====";

    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: DEEP_ANALYSIS_PROMPT },
        ],
      }),
    });

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      console.error(
        `[deep-analysis] upstream ${upstream.status} for ${paperId}: ${errText.slice(0, 500)}`,
      );
      return;
    }

    const j: any = await upstream.json();
    const content: string | undefined = j?.choices?.[0]?.message?.content;
    if (!content || !content.trim()) {
      console.error(`[deep-analysis] empty completion for ${paperId}`);
      return;
    }

    const clean = content.split(String.fromCharCode(0)).join("").trim();
    await db
      .update(papers)
      .set({ aiDeepAnalysis: clean, aiDeepAnalysisAt: sql`now()` })
      .where(eq(papers.id, paperId));
  } catch (e) {
    console.error(`[deep-analysis] failed for ${paperId}:`, e);
  }
}
