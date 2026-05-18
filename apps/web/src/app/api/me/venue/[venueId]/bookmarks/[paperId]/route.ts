import { NextRequest, NextResponse } from "next/server";
import { deleteBookmark } from "@tcr/db/queries";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ venueId: string; paperId: string }> },
) {
  const { venueId, paperId } = await params;
  const { id: userId } = await requireUser();
  await deleteBookmark(userId, venueId, paperId);
  return NextResponse.json({ ok: true });
}
