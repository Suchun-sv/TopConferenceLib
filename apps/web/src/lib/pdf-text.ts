import { eq, sql } from "drizzle-orm";
import { db } from "@tcr/db";
import { papers } from "@tcr/db/schema";

const MAX_PDF_BYTES = 30 * 1024 * 1024; // 30 MB hard cap
const MAX_TEXT_CHARS = 400_000; // ~100k tokens — stored, truncated again at consume time

export type EnsureFullTextResult =
  | { ok: true; cached: boolean; length: number; text: string }
  | { ok: false; status: number; error: string };

/**
 * Make sure papers.full_text is populated for a paper, extracting it from the
 * PDF the first time. Shared by the /process route and the deep-analysis job so
 * the extraction logic lives in exactly one place.
 */
export async function ensureFullText(paperId: string): Promise<EnsureFullTextResult> {
  const rows = await db
    .select({ id: papers.id, pdfUrl: papers.pdfUrl, fullText: papers.fullText })
    .from(papers)
    .where(eq(papers.id, paperId))
    .limit(1);
  const p = rows[0];
  if (!p) return { ok: false, status: 404, error: "not found" };
  if (p.fullText && p.fullText.length > 0) {
    return { ok: true, cached: true, length: p.fullText.length, text: p.fullText };
  }
  if (!p.pdfUrl) return { ok: false, status: 400, error: "no pdf url for this paper" };

  let buf: ArrayBuffer;
  try {
    const r = await fetch(p.pdfUrl, {
      headers: { "User-Agent": "tcr/0.1" },
      redirect: "follow",
    });
    if (!r.ok) return { ok: false, status: 502, error: `pdf fetch ${r.status}` };
    const len = Number(r.headers.get("content-length") ?? 0);
    if (len > MAX_PDF_BYTES) return { ok: false, status: 413, error: "pdf too large" };
    buf = await r.arrayBuffer();
    if (buf.byteLength > MAX_PDF_BYTES) {
      return { ok: false, status: 413, error: "pdf too large" };
    }
  } catch (e) {
    return { ok: false, status: 502, error: `pdf fetch failed: ${String(e)}` };
  }

  let text: string;
  try {
    const { extractText } = await import("unpdf");
    const result = await extractText(new Uint8Array(buf), { mergePages: true });
    text = Array.isArray(result.text) ? result.text.join("\n\n") : result.text;
  } catch (e) {
    return { ok: false, status: 502, error: `pdf parse failed: ${String(e)}` };
  }

  // Postgres text columns reject NUL (0x00); unpdf can emit them.
  text = text.split(String.fromCharCode(0)).join("");

  text = text.replace(/ /g, "").trim();
  if (text.length > MAX_TEXT_CHARS) text = text.slice(0, MAX_TEXT_CHARS);
  if (text.length < 200) {
    return { ok: false, status: 422, error: "extracted text too short — pdf may be scanned" };
  }

  await db
    .update(papers)
    .set({ fullText: text, fullTextAt: sql`now()` })
    .where(eq(papers.id, paperId));

  return { ok: true, cached: false, length: text.length, text };
}
