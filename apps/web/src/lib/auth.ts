import { headers } from "next/headers";
import { eq, sql } from "drizzle-orm";
import { db } from "@tcr/db";
import { users } from "@tcr/db/schema";

const DEV_FALLBACK_EMAIL = process.env.DEV_FALLBACK_EMAIL ?? "suchunsv@gmail.com";

export type SessionUser = { id: string; email: string };

function newUserId(): string {
  // 16 random bytes → 22-char base36-ish id. No new deps.
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  let n = 0n;
  for (const b of buf) n = (n << 8n) | BigInt(b);
  return "usr_" + n.toString(36);
}

async function upsertByEmail(email: string): Promise<SessionUser> {
  const existing = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing[0]) {
    await db
      .update(users)
      .set({ lastSeenAt: sql`now()` })
      .where(eq(users.id, existing[0].id));
    return existing[0];
  }
  const id = newUserId();
  await db.insert(users).values({ id, email });
  return { id, email };
}

/** Read identity from the Cloudflare Access header. Returns null when missing. */
export async function getAccessEmail(): Promise<string | null> {
  const h = await headers();
  return h.get("cf-access-authenticated-user-email");
}

/** Resolve (and provision if needed) the user for this request.
 *  Falls back to a legacy account when the Access header is absent so that
 *  local dev (curl, no tunnel) keeps working. */
export async function getOrCreateUser(): Promise<SessionUser> {
  const email = await getAccessEmail();
  if (email) return upsertByEmail(email);
  return upsertByEmail(DEV_FALLBACK_EMAIL);
}

/** Same as getOrCreateUser. Named for readability at call sites that
 *  semantically require an identity (server actions, page data fetches). */
export async function requireUser(): Promise<SessionUser> {
  return getOrCreateUser();
}
