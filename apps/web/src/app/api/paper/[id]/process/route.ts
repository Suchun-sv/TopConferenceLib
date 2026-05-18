import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@tcr/db";
import { papers } from "@tcr/db/schema";
import { ensureFullText } from "@/lib/pdf-text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const result = await ensureFullText(id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, cached: result.cached, length: result.length });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const rows = await db
    .select({ fullText: papers.fullText, fullTextAt: papers.fullTextAt })
    .from(papers)
    .where(eq(papers.id, id))
    .limit(1);
  const p = rows[0];
  if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({
    ready: !!(p.fullText && p.fullText.length > 0),
    length: p.fullText?.length ?? 0,
    at: p.fullTextAt,
  });
}
