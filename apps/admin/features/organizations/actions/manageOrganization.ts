"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

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

type ActionResult = CreateOrganizationResult;

async function requirePlatformAdmin() {
  const requestHeaders = await headers();
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

function failure(error: unknown): ActionResult {
  if (error instanceof Error) {
    return { status: "error", message: error.message };
  }

  return { status: "error", message: "Organization operation failed." };
}

async function inviteMemberAction(input: InviteMemberInput): Promise<ActionResult> {
  try {
    const currentSession = await requirePlatformAdmin();
    const parsedInput = inviteMemberSchema.parse(input);
    await requireOrganization(parsedInput.organizationId);

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

      revalidatePath(`/organizations/${parsedInput.organizationId}/members`);
      return success(`Added ${parsedInput.email} as ${parsedInput.role}.`);
    }

    const invitationExpiresAt = new Date(Date.now() + 1000 * 60 * 60 * 48);
    await db.insert(invitation).values({
      id: crypto.randomUUID(),
      organizationId: parsedInput.organizationId,
      email: parsedInput.email,
      role: parsedInput.role,
      status: "pending",
      expiresAt: invitationExpiresAt,
      inviterId: currentSession.user.id,
    });

    revalidatePath(`/organizations/${parsedInput.organizationId}/members`);
    return success(`Invited ${parsedInput.email} as ${parsedInput.role}.`);
  } catch (error) {
    return failure(error);
  }
}

async function updateMemberRoleAction(input: UpdateMemberRoleInput): Promise<ActionResult> {
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

    revalidatePath(`/organizations/${parsedInput.organizationId}/members`);
    return success("Updated member role.");
  } catch (error) {
    return failure(error);
  }
}

async function removeMemberAction(input: RemoveMemberInput): Promise<ActionResult> {
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

    revalidatePath(`/organizations/${parsedInput.organizationId}/members`);
    return success("Removed member from organization.");
  } catch (error) {
    return failure(error);
  }
}

async function renameOrganizationAction(input: RenameOrganizationInput): Promise<ActionResult> {
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

    revalidatePath("/organizations");
    revalidatePath(`/organizations/${parsedInput.organizationId}`);
    return success(`Renamed organization to ${parsedInput.name}.`);
  } catch (error) {
    return failure(error);
  }
}

async function setActiveOrganizationAction(
  input: SetActiveOrganizationInput,
): Promise<ActionResult> {
  try {
    const currentSession = await requirePlatformAdmin();
    const parsedInput = setActiveOrganizationSchema.parse(input);
    await requireOrganization(parsedInput.organizationId);

    await db
      .update(session)
      .set({ activeOrganizationId: parsedInput.organizationId })
      .where(eq(session.id, currentSession.session.id));

    revalidatePath(`/organizations/${parsedInput.organizationId}`);
    return success("Set active organization for your current admin session.");
  } catch (error) {
    return failure(error);
  }
}

async function deleteOrganizationAction(input: DeleteOrganizationInput): Promise<ActionResult> {
  let redirectToOrganizations = false;

  try {
    await requirePlatformAdmin();
    const parsedInput = deleteOrganizationSchema.parse(input);
    const existingOrganization = await requireOrganization(parsedInput.organizationId);

    if (parsedInput.confirmationName !== existingOrganization.name) {
      throw new Error("Confirmation name does not match the organization name.");
    }

    await db.delete(organization).where(eq(organization.id, parsedInput.organizationId));
    revalidatePath("/organizations");
    redirectToOrganizations = true;
  } catch (error) {
    return failure(error);
  }

  if (redirectToOrganizations) {
    redirect("/organizations");
  }

  return success("Deleted organization.");
}

export {
  deleteOrganizationAction,
  inviteMemberAction,
  removeMemberAction,
  renameOrganizationAction,
  setActiveOrganizationAction,
  updateMemberRoleAction,
};
