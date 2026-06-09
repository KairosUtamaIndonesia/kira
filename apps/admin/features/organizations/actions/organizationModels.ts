"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import type { CreateOrganizationResult } from "@/features/organizations/actions/types";
import type {
  CreateOrganizationModelInput,
  DeleteOrganizationModelInput,
  SetDefaultOrganizationModelInput,
  UpdateOrganizationModelInput,
} from "@/features/organizations/validation/organizationModel";

import {
  createOrganizationModel,
  deleteOrganizationModel,
  setDefaultOrganizationModel,
  updateOrganizationModel,
} from "@/features/organizations/data/organizationModels";
import {
  createOrganizationModelSchema,
  deleteOrganizationModelSchema,
  setDefaultOrganizationModelSchema,
  updateOrganizationModelSchema,
} from "@/features/organizations/validation/organizationModel";
import { auth } from "@/lib/auth/auth";
import { organization } from "@/lib/db/auth-schema";
import { db } from "@/lib/db/postgres";

type ActionResult = CreateOrganizationResult;

async function requirePlatformAdmin() {
  const requestHeaders = await headers();
  const currentSession = await auth.api.getSession({ headers: requestHeaders });

  if (currentSession === null) {
    throw new Error("Sign in before managing models.");
  }

  if (currentSession.user.role !== "admin") {
    throw new Error("Only platform admins can manage models.");
  }
}

async function requireOrganization(organizationId: string) {
  const [row] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);

  if (row === undefined) {
    throw new Error("Organization was not found.");
  }
}

function failure(error: unknown): ActionResult {
  if (error instanceof Error) {
    return { status: "error", message: error.message };
  }

  return { status: "error", message: "Model operation failed." };
}

async function createOrganizationModelAction(
  input: CreateOrganizationModelInput,
): Promise<ActionResult> {
  try {
    await requirePlatformAdmin();
    const parsedInput = createOrganizationModelSchema.parse(input);
    await requireOrganization(parsedInput.organizationId);
    const model = await createOrganizationModel(parsedInput);
    revalidatePath(`/organizations/${parsedInput.organizationId}/models`);
    return { status: "success", message: `Added model ${model.label}.` };
  } catch (error) {
    return failure(error);
  }
}

async function updateOrganizationModelAction(
  input: UpdateOrganizationModelInput,
): Promise<ActionResult> {
  try {
    await requirePlatformAdmin();
    const parsedInput = updateOrganizationModelSchema.parse(input);
    await requireOrganization(parsedInput.organizationId);
    const model = await updateOrganizationModel(parsedInput);
    revalidatePath(`/organizations/${parsedInput.organizationId}/models`);
    return { status: "success", message: `Updated model ${model.label}.` };
  } catch (error) {
    return failure(error);
  }
}

async function deleteOrganizationModelAction(
  input: DeleteOrganizationModelInput,
): Promise<ActionResult> {
  try {
    await requirePlatformAdmin();
    const parsedInput = deleteOrganizationModelSchema.parse(input);
    await requireOrganization(parsedInput.organizationId);
    await deleteOrganizationModel(parsedInput.organizationId, parsedInput.modelId);
    revalidatePath(`/organizations/${parsedInput.organizationId}/models`);
    return { status: "success", message: "Deleted model." };
  } catch (error) {
    return failure(error);
  }
}

async function setDefaultOrganizationModelAction(
  input: SetDefaultOrganizationModelInput,
): Promise<ActionResult> {
  try {
    await requirePlatformAdmin();
    const parsedInput = setDefaultOrganizationModelSchema.parse(input);
    await requireOrganization(parsedInput.organizationId);
    await setDefaultOrganizationModel(parsedInput.organizationId, parsedInput.modelId);
    revalidatePath(`/organizations/${parsedInput.organizationId}/models`);
    return { status: "success", message: "Updated default model." };
  } catch (error) {
    return failure(error);
  }
}

export {
  createOrganizationModelAction,
  deleteOrganizationModelAction,
  setDefaultOrganizationModelAction,
  updateOrganizationModelAction,
};
