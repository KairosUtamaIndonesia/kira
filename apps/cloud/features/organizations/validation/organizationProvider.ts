import * as z from "zod";

const createOrganizationProviderSchema = z.object({
  organizationId: z.string().min(1, "Organization is required."),
  label: z.string().trim().min(1, "Label is required."),
  providerId: z.string().trim().min(1, "Provider ID is required."),
  providerBaseUrl: z.string().trim().min(1, "Base URL is required.").url("Enter a valid URL."),
  apiKey: z.union([z.string().trim(), z.undefined()]),
  modelsEndpoint: z.union([z.string().trim(), z.undefined()]).optional(),
});

const updateOrganizationProviderSchema = createOrganizationProviderSchema.extend({
  id: z.string().min(1, "Provider ID is required."),
});

const deleteOrganizationProviderSchema = z.object({
  id: z.string().min(1, "Provider ID is required."),
  organizationId: z.string().min(1, "Organization is required."),
});

type CreateOrganizationProviderInput = z.infer<typeof createOrganizationProviderSchema>;
type UpdateOrganizationProviderInput = z.infer<typeof updateOrganizationProviderSchema>;
type DeleteOrganizationProviderInput = z.infer<typeof deleteOrganizationProviderSchema>;

export {
  createOrganizationProviderSchema,
  deleteOrganizationProviderSchema,
  updateOrganizationProviderSchema,
};
export type {
  CreateOrganizationProviderInput,
  DeleteOrganizationProviderInput,
  UpdateOrganizationProviderInput,
};
