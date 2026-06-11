import { createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";

import type { CreateOrganizationResult } from "@/features/organizations/actions/types";
import type {
  InviteMemberInput,
  RemoveMemberInput,
  UpdateMemberRoleInput,
} from "@/features/organizations/validation/manageOrganization";

import {
  inviteMemberSchema,
  removeMemberSchema,
  updateMemberRoleSchema,
} from "@/features/organizations/validation/manageOrganization";
import { requireOrgRole, requireOrganization } from "@/lib/auth/guards";
import { invitation, member, user } from "@/lib/db/auth-schema";
import { db } from "@/lib/db/postgres";
import { sendInvitationEmail } from "@/lib/email/smtp";
import { env } from "@/lib/env";

type ActionResult = CreateOrganizationResult;

function failure(error: unknown): ActionResult {
  if (error instanceof Error) {
    return { status: "error", message: error.message };
  }

  return { status: "error", message: "Organization operation failed." };
}

const inviteOrgMemberAction = createServerFn({ method: "POST" })
  .validator((input: InviteMemberInput) => input)
  .handler(async ({ data: input }): Promise<ActionResult> => {
    try {
      const { session: currentSession } = await requireOrgRole(input.organizationId);
      const parsedInput = inviteMemberSchema.parse(input);
      const existingOrganization = await requireOrganization(parsedInput.organizationId);

      const [existingUser] = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, parsedInput.email))
        .limit(1);

      if (existingUser !== undefined) {
        const [existingMember] = await db
          .select({ id: member.id })
          .from(member)
          .where(
            and(
              eq(member.organizationId, parsedInput.organizationId),
              eq(member.userId, existingUser.id),
            ),
          )
          .limit(1);

        if (existingMember !== undefined) {
          throw new Error("That user is already a member of this organization.");
        }

        await db.insert(member).values({
          id: crypto.randomUUID(),
          organizationId: parsedInput.organizationId,
          userId: existingUser.id,
          role: parsedInput.role,
          createdAt: new Date(),
        });

        return { status: "success", message: `Added ${parsedInput.email} as ${parsedInput.role}.` };
      }

      const invitationId = crypto.randomUUID();
      const invitationExpiresAt = new Date(Date.now() + 1000 * 60 * 60 * 48);
      await db.insert(invitation).values({
        id: invitationId,
        organizationId: parsedInput.organizationId,
        email: parsedInput.email,
        role: parsedInput.role,
        status: "pending",
        expiresAt: invitationExpiresAt,
        inviterId: currentSession.user.id,
      });

      await sendInvitationEmail({
        to: parsedInput.email,
        organizationName: existingOrganization.name,
        inviterName: currentSession.user.name,
        inviteUrl: `${env.BETTER_AUTH_URL}/sign-in?invitationId=${invitationId}`,
        role: parsedInput.role,
      });

      return { status: "success", message: `Invited ${parsedInput.email} as ${parsedInput.role}.` };
    } catch (error) {
      return failure(error);
    }
  });

const updateOrgMemberRoleAction = createServerFn({ method: "POST" })
  .validator((input: UpdateMemberRoleInput) => input)
  .handler(async ({ data: input }): Promise<ActionResult> => {
    try {
      await requireOrgRole(input.organizationId);
      const parsedInput = updateMemberRoleSchema.parse(input);
      await requireOrganization(parsedInput.organizationId);

      await db
        .update(member)
        .set({ role: parsedInput.role })
        .where(
          and(
            eq(member.id, parsedInput.memberId),
            eq(member.organizationId, parsedInput.organizationId),
          ),
        );

      return { status: "success", message: "Updated member role." };
    } catch (error) {
      return failure(error);
    }
  });

const removeOrgMemberAction = createServerFn({ method: "POST" })
  .validator((input: RemoveMemberInput) => input)
  .handler(async ({ data: input }): Promise<ActionResult> => {
    try {
      await requireOrgRole(input.organizationId);
      const parsedInput = removeMemberSchema.parse(input);
      await requireOrganization(parsedInput.organizationId);

      await db
        .delete(member)
        .where(
          and(
            eq(member.id, parsedInput.memberId),
            eq(member.organizationId, parsedInput.organizationId),
          ),
        );

      return { status: "success", message: "Removed member from organization." };
    } catch (error) {
      return failure(error);
    }
  });

export { inviteOrgMemberAction, removeOrgMemberAction, updateOrgMemberRoleAction };
