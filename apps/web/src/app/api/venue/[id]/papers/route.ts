import { NextRequest, NextResponse } from "next/server";
import { listPapersForVenueSectioned } from "@tcr/db/queries";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { id: userId } = await requireUser();
  const url = new URL(req.url);
  const onlyUnseen = url.searchParams.get("unseen") === "1";

  const all = await listPapersForVenueSectioned(id, userId);
  const unseenCount = all.filter((r) => !r.viewedAt).length;
  const rows = onlyUnseen ? all.filter((r) => !r.viewedAt) : all;

  // Group by primaryArea preserving the original sort order.
  const sections: { area: string; rows: typeof rows }[] = [];
  let last = "";
  for (const r of rows) {
    if (r.primaryArea !== last) {
      sections.push({ area: r.primaryArea, rows: [] });
      last = r.primaryArea;
    }
    sections[sections.length - 1].rows.push(r);
  }
  return NextResponse.json({
    sections,
    total: rows.length,
    totalAll: all.length,
    unseenCount,
  });
}
