import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@tcr/db";
import { paperChats, papers } from "@tcr/db/schema";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Msg = { role: "user" | "assistant"; content: string };

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: paperId } = await params;
  const { id: userId } = await requireUser();
  const rows = await db
    .select({ messages: paperChats.messages, updatedAt: paperChats.updatedAt })
    .from(paperChats)
    .where(and(eq(paperChats.userId, userId), eq(paperChats.paperId, paperId)))
    .limit(1);
  const r = rows[0];
  return NextResponse.json({
    messages: r?.messages ?? [],
    updatedAt: r?.updatedAt ?? null,
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: paperId } = await params;
  const { id: userId } = await requireUser();

  // Sanity check the paper exists so we don't insert a chat for a stale id.
  const exists = await db
    .select({ id: papers.id })
    .from(papers)
    .where(eq(papers.id, paperId))
    .limit(1);
  if (!exists[0]) return NextResponse.json({ error: "paper not found" }, { status: 404 });

  let body: { messages: Msg[] };
  try {
    body = (await req.json()) as { messages: Msg[] };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!Array.isArray(body.messages)) {
    return NextResponse.json({ error: "messages array required" }, { status: 400 });
  }
  // Cap to avoid runaway rows
  const messages = body.messages.slice(-200).map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: String(m.content ?? "").slice(0, 100_000),
  })) as Msg[];

  await db
    .insert(paperChats)
    .values({ userId, paperId, messages })
    .onConflictDoUpdate({
      target: [paperChats.userId, paperChats.paperId],
      set: { messages, updatedAt: sql`now()` },
    });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: paperId } = await params;
  const { id: userId } = await requireUser();
  await db
    .delete(paperChats)
    .where(and(eq(paperChats.userId, userId), eq(paperChats.paperId, paperId)));
  return NextResponse.json({ ok: true });
}
