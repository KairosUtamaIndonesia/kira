import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { eq } from "drizzle-orm";

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
  const requestHeaders = getRequest().headers;
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

const createOrganizationModelAction = createServerFn({ method: "POST" })
  .validator((input: CreateOrganizationModelInput) => input)
  .handler(async ({ data: input }): Promise<ActionResult> => {
    try {
      await requirePlatformAdmin();
      const parsedInput = createOrganizationModelSchema.parse(input);
      await requireOrganization(parsedInput.organizationId);
      const model = await createOrganizationModel(parsedInput);
      return { status: "success", message: `Added model ${model.label}.` };
    } catch (error) {
      return failure(error);
    }
  });

const updateOrganizationModelAction = createServerFn({ method: "POST" })
  .validator((input: UpdateOrganizationModelInput) => input)
  .handler(async ({ data: input }): Promise<ActionResult> => {
    try {
      await requirePlatformAdmin();
      const parsedInput = updateOrganizationModelSchema.parse(input);
      await requireOrganization(parsedInput.organizationId);
      const model = await updateOrganizationModel(parsedInput);
      return { status: "success", message: `Updated model ${model.label}.` };
    } catch (error) {
      return failure(error);
    }
  });

const deleteOrganizationModelAction = createServerFn({ method: "POST" })
  .validator((input: DeleteOrganizationModelInput) => input)
  .handler(async ({ data: input }): Promise<ActionResult> => {
    try {
      await requirePlatformAdmin();
      const parsedInput = deleteOrganizationModelSchema.parse(input);
      await requireOrganization(parsedInput.organizationId);
      await deleteOrganizationModel(parsedInput.organizationId, parsedInput.modelId);
      return { status: "success", message: "Deleted model." };
    } catch (error) {
      return failure(error);
    }
  });

const setDefaultOrganizationModelAction = createServerFn({ method: "POST" })
  .validator((input: SetDefaultOrganizationModelInput) => input)
  .handler(async ({ data: input }): Promise<ActionResult> => {
    try {
      await requirePlatformAdmin();
      const parsedInput = setDefaultOrganizationModelSchema.parse(input);
      await requireOrganization(parsedInput.organizationId);
      await setDefaultOrganizationModel(parsedInput.organizationId, parsedInput.modelId);
      return { status: "success", message: "Updated default model." };
    } catch (error) {
      return failure(error);
    }
  });

export {
  createOrganizationModelAction,
  deleteOrganizationModelAction,
  setDefaultOrganizationModelAction,
  updateOrganizationModelAction,
};
