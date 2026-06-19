import { createServerFn } from "@tanstack/react-start";

import type { CreateOrganizationResult } from "@/features/organizations/actions/types";
import type {
  CreateOrganizationModelInput,
  DeleteOrganizationModelInput,
  SetDefaultOrganizationModelInput,
  UpdateOrganizationModelInput,
} from "@/features/organizations/validation/organizationModel";

import {
  createOrganizationModelSchema,
  deleteOrganizationModelSchema,
  setDefaultOrganizationModelSchema,
  updateOrganizationModelSchema,
} from "@/features/organizations/validation/organizationModel";
import { requireOrgPermission, requireOrganization } from "@/lib/auth/guards";

import {
  createOrganizationModel,
  deleteOrganizationModel,
  setDefaultOrganizationModel,
  updateOrganizationModel,
} from "../data/models";

type ActionResult = CreateOrganizationResult;

function failure(error: unknown): ActionResult {
  if (error instanceof Error) {
    return { status: "error", message: error.message };
  }

  return { status: "error", message: "Model operation failed." };
}

const createOrgModelAction = createServerFn({ method: "POST" })
  .validator((input: CreateOrganizationModelInput) => input)
  .handler(async ({ data: input }): Promise<ActionResult> => {
    try {
      await requireOrgPermission(input.organizationId, { model: ["create"] });
      const parsedInput = createOrganizationModelSchema.parse(input);
      await requireOrganization(parsedInput.organizationId);
      const model = await createOrganizationModel(parsedInput);
      return { status: "success", message: `Added model ${model.label}.` };
    } catch (error) {
      return failure(error);
    }
  });

const updateOrgModelAction = createServerFn({ method: "POST" })
  .validator((input: UpdateOrganizationModelInput) => input)
  .handler(async ({ data: input }): Promise<ActionResult> => {
    try {
      await requireOrgPermission(input.organizationId, { model: ["update"] });
      const parsedInput = updateOrganizationModelSchema.parse(input);
      await requireOrganization(parsedInput.organizationId);
      const model = await updateOrganizationModel(parsedInput);
      return { status: "success", message: `Updated model ${model.label}.` };
    } catch (error) {
      return failure(error);
    }
  });

const deleteOrgModelAction = createServerFn({ method: "POST" })
  .validator((input: DeleteOrganizationModelInput) => input)
  .handler(async ({ data: input }): Promise<ActionResult> => {
    try {
      await requireOrgPermission(input.organizationId, { model: ["delete"] });
      const parsedInput = deleteOrganizationModelSchema.parse(input);
      await requireOrganization(parsedInput.organizationId);
      await deleteOrganizationModel(parsedInput.organizationId, parsedInput.modelId);
      return { status: "success", message: "Deleted model." };
    } catch (error) {
      return failure(error);
    }
  });

const setDefaultOrgModelAction = createServerFn({ method: "POST" })
  .validator((input: SetDefaultOrganizationModelInput) => input)
  .handler(async ({ data: input }): Promise<ActionResult> => {
    try {
      await requireOrgPermission(input.organizationId, { model: ["update"] });
      const parsedInput = setDefaultOrganizationModelSchema.parse(input);
      await requireOrganization(parsedInput.organizationId);
      await setDefaultOrganizationModel(parsedInput.organizationId, parsedInput.modelId);
      return { status: "success", message: "Updated default model." };
    } catch (error) {
      return failure(error);
    }
  });

export {
  createOrgModelAction,
  deleteOrgModelAction,
  setDefaultOrgModelAction,
  updateOrgModelAction,
};
