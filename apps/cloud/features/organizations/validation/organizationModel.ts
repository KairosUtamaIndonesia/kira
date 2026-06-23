import * as z from "zod";

const capabilitySchema = z.object({
  reasoning: z.boolean().optional(),
  thinking: z.boolean().optional(),
  tool_calling: z.boolean().optional(),
  vision: z.boolean().optional(),
});

const organizationModelSchema = z.object({
  label: z.string().trim().min(1, "Label is required."),
  upstreamModelId: z.string().trim().min(1, "Model ID is required."),
  providerId: z.string().trim().min(1, "Provider ID is required."),
  providerConfigId: z.string().uuid("Provider configuration is required."),
  contextWindow: z.number().int().positive("Context window must be a positive integer."),
  maxOutputTokens: z.number().int().positive("Max output tokens must be a positive integer."),
  maxInputTokens: z.union([z.number().int().positive(), z.undefined()]),
  isDefault: z.boolean(),
  capabilities: z.union([capabilitySchema, z.undefined()]),
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
  capabilitySchema,
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
