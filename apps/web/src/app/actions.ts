"use server";

import { revalidatePath } from "next/cache";
import { setMark } from "@tcr/db/queries";

const USER = "me";

export async function toggleLike(paperId: string, liked: boolean) {
  await setMark(USER, paperId, { liked });
  revalidatePath("/marks");
  return { ok: true };
}

export async function toggleLater(paperId: string, later: boolean) {
  await setMark(USER, paperId, { later });
  revalidatePath("/marks");
  return { ok: true };
}

export async function toggleHidden(paperId: string, hidden: boolean) {
  await setMark(USER, paperId, { hidden });
  revalidatePath("/marks");
  return { ok: true };
}
