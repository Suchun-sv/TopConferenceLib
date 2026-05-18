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
    .select({ abstract: papers.abstract, abstractZh: papers.abstractZh })
    .from(papers)
    .where(eq(papers.id, id))
    .limit(1);
  const p = rows[0];
  if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ abstract: p.abstract, abstractZh: p.abstractZh });
}
