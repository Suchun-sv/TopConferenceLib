"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { setMark, enqueueKhojExports, listMarkedPaperIds } from "@tcr/db/queries";
import { requireUser } from "@/lib/auth";
import { generateDeepAnalysis } from "@/lib/deep-analysis";

function getOpenPaperBaseUrl() {
  return (process.env.OPENPAPER_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export async function toggleLike(paperId: string, liked: boolean) {
  const { id } = await requireUser();
  await setMark(id, paperId, { liked });
  if (liked) after(() => generateDeepAnalysis(paperId));
  revalidatePath("/marks");
  return { ok: true };
}

export async function toggleLater(paperId: string, later: boolean) {
  const { id } = await requireUser();
  await setMark(id, paperId, { later });
  if (later) after(() => generateDeepAnalysis(paperId));
  revalidatePath("/marks");
  return { ok: true };
}

export async function toggleHidden(paperId: string, hidden: boolean) {
  const { id } = await requireUser();
  await setMark(id, paperId, { hidden });
  revalidatePath("/marks");
  return { ok: true };
}

export async function setNote(paperId: string, note: string) {
  const { id } = await requireUser();
  await setMark(id, paperId, { note });
  revalidatePath(`/p/${paperId}`);
  return { ok: true };
}

export async function sendToKhoj(paperId: string) {
  const { id } = await requireUser();
  const r = await enqueueKhojExports([paperId], id);
  return { ok: true, ...r };
}

export async function sendBatchToKhoj(tab: "liked" | "later") {
  const { id } = await requireUser();
  const ids = await listMarkedPaperIds(id, tab);
  const r = await enqueueKhojExports(ids, id);
  return { ok: true, total: ids.length, ...r };
}

export async function openInOpenPaper(paperId: string) {
  const user = await requireUser();
  const baseUrl = getOpenPaperBaseUrl();
  const response = await fetch(`${baseUrl}/api/integrations/top-conference-lib/import-paper`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tcl_user_email: user.email,
      openpaper_user_email: user.email,
      paper_id: paperId,
    }),
    cache: "no-store",
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.detail ?? data?.message ?? "OpenPaper import failed");
  }

  return {
    ok: true,
    ...data,
    url: data?.paper_id ? `${baseUrl}/paper/${data.paper_id}` : `${baseUrl}/papers`,
  };
}

export async function syncLikedToOpenPaper(limit = 200) {
  const user = await requireUser();
  const baseUrl = getOpenPaperBaseUrl();
  const response = await fetch(`${baseUrl}/api/integrations/top-conference-lib/sync-liked`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tcl_user_email: user.email,
      openpaper_user_email: user.email,
      limit,
    }),
    cache: "no-store",
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.detail ?? data?.message ?? "OpenPaper sync failed");
  }
  return { ok: true, ...data, openpaperBaseUrl: baseUrl };
}
