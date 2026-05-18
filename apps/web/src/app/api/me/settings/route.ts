import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@tcr/db";
import { userSettings } from "@tcr/db/schema";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { ciphertext: string; iv: string; salt: string };

export async function GET() {
  const { id } = await requireUser();
  const rows = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, id))
    .limit(1);
  const r = rows[0];
  if (!r) return NextResponse.json({ exists: false });
  return NextResponse.json({
    exists: true,
    ciphertext: r.ciphertext,
    iv: r.iv,
    salt: r.salt,
    updatedAt: r.updatedAt,
  });
}

export async function PUT(req: NextRequest) {
  const { id } = await requireUser();
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.ciphertext || !body.iv || !body.salt) {
    return NextResponse.json({ error: "ciphertext, iv, salt required" }, { status: 400 });
  }
  await db
    .insert(userSettings)
    .values({
      userId: id,
      ciphertext: body.ciphertext,
      iv: body.iv,
      salt: body.salt,
    })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: {
        ciphertext: body.ciphertext,
        iv: body.iv,
        salt: body.salt,
        updatedAt: sql`now()`,
      },
    });
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const { id } = await requireUser();
  await db.delete(userSettings).where(eq(userSettings.userId, id));
  return NextResponse.json({ ok: true });
}
