import { NextRequest, NextResponse } from "next/server";
import { listBookmarks, upsertBookmark } from "@tcr/db/queries";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ venueId: string }> },
) {
  const { venueId } = await params;
  const { id: userId } = await requireUser();
  const bookmarks = await listBookmarks(userId, venueId);
  return NextResponse.json({ bookmarks });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ venueId: string }> },
) {
  const { venueId } = await params;
  const { id: userId } = await requireUser();
  let body: { paperId?: string; label?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.paperId) {
    return NextResponse.json({ error: "paperId required" }, { status: 400 });
  }
  const label = (body.label ?? "").trim().slice(0, 80) || null;
  await upsertBookmark(userId, venueId, body.paperId, label);
  return NextResponse.json({ ok: true });
}
