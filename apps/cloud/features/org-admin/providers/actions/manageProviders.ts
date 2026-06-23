import { createServerFn } from "@tanstack/react-start";

import type { CreateOrganizationResult } from "@/features/organizations/actions/types";
import type { OrganizationProvider } from "@/features/organizations/types";
import type {
  CreateOrganizationProviderInput,
  DeleteOrganizationProviderInput,
  UpdateOrganizationProviderInput,
} from "@/features/organizations/validation/organizationProvider";

import {
  createOrganizationProvider,
  deleteOrganizationProvider,
  getOrganizationProvider,
  listOrganizationProviders,
  updateOrganizationProvider,
} from "@/features/organizations/data/organizationProviders";
import {
  createOrganizationProviderSchema,
  deleteOrganizationProviderSchema,
  updateOrganizationProviderSchema,
} from "@/features/organizations/validation/organizationProvider";
import { requireOrgPermission, requireOrganization } from "@/lib/auth/guards";

type ActionResult = CreateOrganizationResult;

function failure(error: unknown): ActionResult {
  if (error instanceof Error) {
    return { status: "error", message: error.message };
  }

  return { status: "error", message: "Provider operation failed." };
}

const createOrgProviderAction = createServerFn({ method: "POST" })
  .validator((input: CreateOrganizationProviderInput) => input)
  .handler(async ({ data: input }): Promise<ActionResult> => {
    try {
      await requireOrgPermission(input.organizationId, { model: ["create"] });
      const parsedInput = createOrganizationProviderSchema.parse(input);
      await requireOrganization(parsedInput.organizationId);
      const provider = await createOrganizationProvider(parsedInput);
      return { status: "success", message: `Added provider ${provider.label}.` };
    } catch (error) {
      return failure(error);
    }
  });

const updateOrgProviderAction = createServerFn({ method: "POST" })
  .validator((input: UpdateOrganizationProviderInput) => input)
  .handler(async ({ data: input }): Promise<ActionResult> => {
    try {
      await requireOrgPermission(input.organizationId, { model: ["update"] });
      const parsedInput = updateOrganizationProviderSchema.parse(input);
      await requireOrganization(parsedInput.organizationId);
      const provider = await updateOrganizationProvider(parsedInput);
      return { status: "success", message: `Updated provider ${provider.label}.` };
    } catch (error) {
      return failure(error);
    }
  });

const deleteOrgProviderAction = createServerFn({ method: "POST" })
  .validator((input: DeleteOrganizationProviderInput) => input)
  .handler(async ({ data: input }): Promise<ActionResult> => {
    try {
      await requireOrgPermission(input.organizationId, { model: ["delete"] });
      const parsedInput = deleteOrganizationProviderSchema.parse(input);
      await requireOrganization(parsedInput.organizationId);
      await deleteOrganizationProvider(parsedInput.organizationId, parsedInput.id);
      return { status: "success", message: "Deleted provider." };
    } catch (error) {
      return failure(error);
    }
  });

const listOrgProvidersAction = createServerFn({ method: "GET" })
  .validator((input: { organizationId: string }) => input)
  .handler(async ({ data: input }) => {
    try {
      await requireOrgPermission(input.organizationId, { model: ["read"] });
      await requireOrganization(input.organizationId);
      const providers = await listOrganizationProviders(input.organizationId);
      return { status: "success" as const, providers };
    } catch (error) {
      return {
        status: "error" as const,
        message: error instanceof Error ? error.message : "Failed to list providers.",
        providers: [],
      };
    }
  });

type GetProviderResult =
  | { status: "success"; provider: OrganizationProvider }
  | { status: "error"; message: string };

const getOrgProviderAction = createServerFn({ method: "GET" })
  .validator((input: { organizationId: string; id: string }) => input)
  .handler(async ({ data: input }): Promise<GetProviderResult> => {
    try {
      await requireOrgPermission(input.organizationId, { model: ["read"] });
      await requireOrganization(input.organizationId);
      const provider = await getOrganizationProvider(input.organizationId, input.id);
      return { status: "success", provider };
    } catch (error) {
      return {
        status: "error",
        message: error instanceof Error ? error.message : "Failed to get provider.",
      };
    }
  });

export {
  createOrgProviderAction,
  deleteOrgProviderAction,
  getOrgProviderAction,
  listOrgProvidersAction,
  updateOrgProviderAction,
};
