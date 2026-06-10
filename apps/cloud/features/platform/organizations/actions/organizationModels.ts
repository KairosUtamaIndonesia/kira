import { createServerFn } from "@tanstack/react-start";

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
import { requireOrganization, requirePlatformAdmin } from "@/lib/auth/guards";

type ActionResult = CreateOrganizationResult;

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
