import { and, eq, isNotNull, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";

import { user } from "@/lib/db/auth-schema";
import { db } from "@/lib/db/postgres";
import { desktopSigninHandoffs } from "@/lib/db/schema";

const handoffExpiresInSeconds = 300;

function hashHandoffCode(handoffCode: string): string {
  return createHash("sha256").update(handoffCode).digest("hex");
}

// Creates a one-time handoff the desktop redeems over its loopback callback.
// Only the SHA-256 hash of the code is stored; the plaintext is returned once.
async function createHandoff(input: {
  userId: string;
  organizationId: string;
  organizationName: string;
  apiKey: string;
}): Promise<string> {
  const handoffCode = randomBytes(32).toString("base64url");

  await db.insert(desktopSigninHandoffs).values({
    handoffCodeHash: hashHandoffCode(handoffCode),
    userId: input.userId,
    organizationId: input.organizationId,
    organizationName: input.organizationName,
    apiKey: input.apiKey,
    expiresAt: new Date(Date.now() + handoffExpiresInSeconds * 1000),
  });

  return handoffCode;
}

type ClaimedHandoff = {
  apiKey: string;
  organizationId: string;
  organizationName: string;
  userName: string;
  userEmail: string;
};

// Atomically consumes a handoff: the single UPDATE that still sees a present,
// unexpired key wins; concurrent or replayed claims see the nulled key and fail.
async function claimHandoff(handoffCode: string): Promise<ClaimedHandoff | undefined> {
  const [row] = await db
    .select()
    .from(desktopSigninHandoffs)
    .where(eq(desktopSigninHandoffs.handoffCodeHash, hashHandoffCode(handoffCode)))
    .limit(1);

  if (
    row === undefined ||
    row.apiKey === null ||
    row.consumedAt !== null ||
    row.expiresAt.getTime() <= Date.now()
  ) {
    return undefined;
  }

  const [consumed] = await db
    .update(desktopSigninHandoffs)
    .set({ apiKey: sql`NULL`, consumedAt: new Date() })
    .where(and(eq(desktopSigninHandoffs.id, row.id), isNotNull(desktopSigninHandoffs.apiKey)))
    .returning({ apiKey: desktopSigninHandoffs.id });

  if (consumed === undefined) {
    return undefined;
  }

  const [owner] = await db
    .select({ name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, row.userId))
    .limit(1);

  return {
    apiKey: row.apiKey,
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    userName: owner === undefined ? "" : owner.name,
    userEmail: owner === undefined ? "" : owner.email,
  };
}

export { claimHandoff, createHandoff };
export type { ClaimedHandoff };
