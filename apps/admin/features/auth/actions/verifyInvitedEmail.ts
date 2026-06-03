"use server";

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";

import type { VerifyInvitedEmailResult } from "@/features/auth/actions/types";

import { auth } from "@/lib/auth/auth";
import { invitation, user } from "@/lib/db/auth-schema";
import { db } from "@/lib/db/postgres";

async function verifyInvitedEmailAction(invitationId: string): Promise<VerifyInvitedEmailResult> {
  const currentSession = await auth.api.getSession({ headers: await headers() });

  if (currentSession === null) {
    return {
      status: "error",
      message: "Sign in before accepting the invitation.",
    };
  }

  const [pendingInvitation] = await db
    .select({ email: invitation.email })
    .from(invitation)
    .where(and(eq(invitation.id, invitationId), eq(invitation.status, "pending")))
    .limit(1);

  if (pendingInvitation === undefined) {
    return {
      status: "error",
      message: "Invitation was not found or is no longer pending.",
    };
  }

  if (pendingInvitation.email.toLowerCase() !== currentSession.user.email.toLowerCase()) {
    return {
      status: "error",
      message: "Sign in with the invited email address before accepting the invitation.",
    };
  }

  await db.update(user).set({ emailVerified: true }).where(eq(user.id, currentSession.user.id));

  return {
    status: "success",
    message: "Verified invited email address.",
  };
}

export { verifyInvitedEmailAction };
