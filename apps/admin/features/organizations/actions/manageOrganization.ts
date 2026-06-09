import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { and, eq } from "drizzle-orm";

import type { CreateOrganizationResult } from "@/features/organizations/actions/types";
import type {
  DeleteOrganizationInput,
  InviteMemberInput,
  RemoveMemberInput,
  RenameOrganizationInput,
  SetActiveOrganizationInput,
  UpdateMemberRoleInput,
} from "@/features/organizations/validation/manageOrganization";

import { createOrganizationSlug } from "@/features/organizations/validation/createOrganization";
import {
  deleteOrganizationSchema,
  inviteMemberSchema,
  removeMemberSchema,
  renameOrganizationSchema,
  setActiveOrganizationSchema,
  updateMemberRoleSchema,
} from "@/features/organizations/validation/manageOrganization";
import { auth } from "@/lib/auth/auth";
import { invitation, member, organization, session, user } from "@/lib/db/auth-schema";
import { db } from "@/lib/db/postgres";
import { sendInvitationEmail } from "@/lib/email/smtp";
import { env } from "@/lib/env";

type ActionResult = CreateOrganizationResult;

async function requirePlatformAdmin() {
  const requestHeaders = getRequest().headers;
  const currentSession = await auth.api.getSession({ headers: requestHeaders });

  if (currentSession === null) {
    throw new Error("Sign in before managing organizations.");
  }

  if (currentSession.user.role !== "admin") {
    throw new Error("Only platform admins can manage organizations.");
  }

  return currentSession;
}

async function requireOrganization(organizationId: string) {
  const [row] = await db
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);

  if (row === undefined) {
    throw new Error("Organization was not found.");
  }

  return row;
}

async function ensureOrganizationSlugAvailable(slug: string, organizationId: string) {
  const [existingOrganization] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, slug))
    .limit(1);

  if (existingOrganization !== undefined && existingOrganization.id !== organizationId) {
    throw new Error(`Organization slug is already in use: ${slug}`);
  }
}

function success(message: string): ActionResult {
  return { status: "success", message };
}

function invitationUrl(invitationId: string) {
  const baseUrl = env.BETTER_AUTH_URL;
  return `${baseUrl}/sign-in?invitationId=${invitationId}`;
}

function failure(error: unknown): ActionResult {
  if (error instanceof Error) {
    return { status: "error", message: error.message };
  }

  return { status: "error", message: "Organization operation failed." };
}

const inviteMemberAction = createServerFn({ method: "POST" })
  .validator((input: InviteMemberInput) => input)
  .handler(async ({ data: input }): Promise<ActionResult> => {
    try {
      const currentSession = await requirePlatformAdmin();
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

        return success(`Added ${parsedInput.email} as ${parsedInput.role}.`);
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
        inviteUrl: invitationUrl(invitationId),
        role: parsedInput.role,
      });

      return success(`Invited ${parsedInput.email} as ${parsedInput.role}.`);
    } catch (error) {
      return failure(error);
    }
  });

const updateMemberRoleAction = createServerFn({ method: "POST" })
  .validator((input: UpdateMemberRoleInput) => input)
  .handler(async ({ data: input }): Promise<ActionResult> => {
    try {
      await requirePlatformAdmin();
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

      return success("Updated member role.");
    } catch (error) {
      return failure(error);
    }
  });

const removeMemberAction = createServerFn({ method: "POST" })
  .validator((input: RemoveMemberInput) => input)
  .handler(async ({ data: input }): Promise<ActionResult> => {
    try {
      await requirePlatformAdmin();
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

      return success("Removed member from organization.");
    } catch (error) {
      return failure(error);
    }
  });

const renameOrganizationAction = createServerFn({ method: "POST" })
  .validator((input: RenameOrganizationInput) => input)
  .handler(async ({ data: input }): Promise<ActionResult> => {
    try {
      await requirePlatformAdmin();
      const parsedInput = renameOrganizationSchema.parse(input);
      await requireOrganization(parsedInput.organizationId);
      const slug = createOrganizationSlug(parsedInput.name);
      await ensureOrganizationSlugAvailable(slug, parsedInput.organizationId);

      await db
        .update(organization)
        .set({ name: parsedInput.name, slug })
        .where(eq(organization.id, parsedInput.organizationId));

      return success(`Renamed organization to ${parsedInput.name}.`);
    } catch (error) {
      return failure(error);
    }
  });

const setActiveOrganizationAction = createServerFn({ method: "POST" })
  .validator((input: SetActiveOrganizationInput) => input)
  .handler(async ({ data: input }): Promise<ActionResult> => {
    try {
      const currentSession = await requirePlatformAdmin();
      const parsedInput = setActiveOrganizationSchema.parse(input);
      await requireOrganization(parsedInput.organizationId);

      await db
        .update(session)
        .set({ activeOrganizationId: parsedInput.organizationId })
        .where(eq(session.id, currentSession.session.id));

      return success("Set active organization for your current admin session.");
    } catch (error) {
      return failure(error);
    }
  });

const deleteOrganizationAction = createServerFn({ method: "POST" })
  .validator((input: DeleteOrganizationInput) => input)
  .handler(async ({ data: input }): Promise<ActionResult> => {
    let redirectToOrganizations = false;

    try {
      await requirePlatformAdmin();
      const parsedInput = deleteOrganizationSchema.parse(input);
      const existingOrganization = await requireOrganization(parsedInput.organizationId);

      if (parsedInput.confirmationName !== existingOrganization.name) {
        throw new Error("Confirmation name does not match the organization name.");
      }

      await db.delete(organization).where(eq(organization.id, parsedInput.organizationId));
      redirectToOrganizations = true;
    } catch (error) {
      return failure(error);
    }

    if (redirectToOrganizations) {
      throw redirect({ to: "/organizations" });
    }

    return success("Deleted organization.");
  });

export {
  deleteOrganizationAction,
  inviteMemberAction,
  removeMemberAction,
  renameOrganizationAction,
  setActiveOrganizationAction,
  updateMemberRoleAction,
};
