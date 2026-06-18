import * as z from "zod";

const organizationModelSchema = z.object({
  label: z.string().trim().min(1, "Label is required."),
  upstreamModelId: z.string().trim().min(1, "Model ID is required."),
  providerId: z.string().trim().min(1, "Provider ID is required."),
  providerBaseUrl: z.string().trim().min(1, "Base URL is required.").url("Enter a valid URL."),
  contextWindow: z.number().int().positive("Context window must be a positive integer."),
  maxOutputTokens: z.number().int().positive("Max output tokens must be a positive integer."),
  isDefault: z.boolean(),
  apiKey: z.union([z.string().trim(), z.undefined()]),
});

const createOrganizationModelSchema = z.object({
  organizationId: z.string().min(1, "Organization is required."),
  ...organizationModelSchema.shape,
});

const updateOrganizationModelSchema = z.object({
  organizationId: z.string().min(1, "Organization is required."),
  modelId: z.string().min(1, "Model ID is required."),
  ...organizationModelSchema.shape,
});

const deleteOrganizationModelSchema = z.object({
  organizationId: z.string().min(1, "Organization is required."),
  modelId: z.string().min(1, "Model ID is required."),
});

const setDefaultOrganizationModelSchema = z.object({
  organizationId: z.string().min(1, "Organization is required."),
  modelId: z.string().min(1, "Model ID is required."),
});

type CreateOrganizationModelInput = z.infer<typeof createOrganizationModelSchema>;
type UpdateOrganizationModelInput = z.infer<typeof updateOrganizationModelSchema>;
type DeleteOrganizationModelInput = z.infer<typeof deleteOrganizationModelSchema>;
type SetDefaultOrganizationModelInput = z.infer<typeof setDefaultOrganizationModelSchema>;

export {
  createOrganizationModelSchema,
  deleteOrganizationModelSchema,
  organizationModelSchema,
  setDefaultOrganizationModelSchema,
  updateOrganizationModelSchema,
};
export type {
  CreateOrganizationModelInput,
  DeleteOrganizationModelInput,
  SetDefaultOrganizationModelInput,
  UpdateOrganizationModelInput,
};
