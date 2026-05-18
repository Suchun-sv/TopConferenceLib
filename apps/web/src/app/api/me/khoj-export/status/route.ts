import { NextRequest, NextResponse } from "next/server";
import { khojExportStatus } from "@tcr/db/queries";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  await requireUser();
  const ids = (new URL(req.url).searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const status = await khojExportStatus(ids);
  return NextResponse.json({ status });
}
