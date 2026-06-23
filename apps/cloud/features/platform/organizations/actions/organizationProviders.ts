import { createServerFn } from "@tanstack/react-start";

import type { CreateOrganizationResult } from "@/features/organizations/actions/types";
import type {
  CreateOrganizationProviderInput,
  DeleteOrganizationProviderInput,
  UpdateOrganizationProviderInput,
} from "@/features/organizations/validation/organizationProvider";

import {
  createOrganizationProvider,
  deleteOrganizationProvider,
  updateOrganizationProvider,
} from "@/features/organizations/data/organizationProviders";
import {
  createOrganizationProviderSchema,
  deleteOrganizationProviderSchema,
  updateOrganizationProviderSchema,
} from "@/features/organizations/validation/organizationProvider";
import { requireOrganization, requirePlatformAdmin } from "@/lib/auth/guards";

type ActionResult = CreateOrganizationResult;

function failure(error: unknown): ActionResult {
  if (error instanceof Error) {
    return { status: "error", message: error.message };
  }

  return { status: "error", message: "Provider operation failed." };
}

const createOrganizationProviderAction = createServerFn({ method: "POST" })
  .validator((input: CreateOrganizationProviderInput) => input)
  .handler(async ({ data: input }): Promise<ActionResult> => {
    try {
      await requirePlatformAdmin();
      const parsedInput = createOrganizationProviderSchema.parse(input);
      await requireOrganization(parsedInput.organizationId);
      const provider = await createOrganizationProvider(parsedInput);
      return { status: "success", message: `Added provider ${provider.label}.` };
    } catch (error) {
      return failure(error);
    }
  });

const updateOrganizationProviderAction = createServerFn({ method: "POST" })
  .validator((input: UpdateOrganizationProviderInput) => input)
  .handler(async ({ data: input }): Promise<ActionResult> => {
    try {
      await requirePlatformAdmin();
      const parsedInput = updateOrganizationProviderSchema.parse(input);
      await requireOrganization(parsedInput.organizationId);
      const provider = await updateOrganizationProvider(parsedInput);
      return { status: "success", message: `Updated provider ${provider.label}.` };
    } catch (error) {
      return failure(error);
    }
  });

const deleteOrganizationProviderAction = createServerFn({ method: "POST" })
  .validator((input: DeleteOrganizationProviderInput) => input)
  .handler(async ({ data: input }): Promise<ActionResult> => {
    try {
      await requirePlatformAdmin();
      const parsedInput = deleteOrganizationProviderSchema.parse(input);
      await requireOrganization(parsedInput.organizationId);
      await deleteOrganizationProvider(parsedInput.organizationId, parsedInput.id);
      return { status: "success", message: "Deleted provider." };
    } catch (error) {
      return failure(error);
    }
  });

export {
  createOrganizationProviderAction,
  deleteOrganizationProviderAction,
  updateOrganizationProviderAction,
};
