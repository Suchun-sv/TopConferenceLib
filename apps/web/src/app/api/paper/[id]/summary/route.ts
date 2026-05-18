import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@tcr/db";
import { papers } from "@tcr/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const rows = await db
    .select({ aiSummaryV1: papers.aiSummaryV1, aiSummaryV1At: papers.aiSummaryV1At })
    .from(papers)
    .where(eq(papers.id, id))
    .limit(1);
  const p = rows[0];
  if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ aiSummaryV1: p.aiSummaryV1, aiSummaryV1At: p.aiSummaryV1At });
}
