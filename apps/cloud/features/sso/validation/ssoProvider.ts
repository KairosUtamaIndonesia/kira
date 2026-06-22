import * as z from "zod";

const azureTenantIdSchema = z
  .string()
  .trim()
  .min(1, "Azure tenant ID is required.")
  .regex(/^[a-zA-Z0-9.-]+$/, "Azure tenant ID contains unsupported characters.");

const registerAzureSsoProviderSchema = z.object({
  organizationId: z.string().min(1, "Organization is required."),
  organizationSlug: z.string().min(1, "Organization slug is required."),
  tenantId: azureTenantIdSchema,
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Email domain is required.")
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, "Enter a valid email domain."),
  clientId: z.string().trim().min(1, "Client ID is required."),
  clientSecret: z.string().min(1, "Client secret is required."),
});

const verifySsoDomainSchema = z.object({
  organizationId: z.string().min(1, "Organization is required."),
  providerId: z.string().min(1, "SSO provider is required."),
});

type RegisterAzureSsoProviderInput = z.infer<typeof registerAzureSsoProviderSchema>;
type VerifySsoDomainInput = z.infer<typeof verifySsoDomainSchema>;

const updateSsoProviderSchema = z.object({
  organizationId: z.string().min(1, "Organization is required."),
  providerId: z.string().min(1, "SSO provider is required."),
  clientId: z.string().trim().min(1, "Client ID is required."),
  clientSecret: z.string().optional(),
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Email domain is required.")
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, "Enter a valid email domain."),
});

type UpdateSsoProviderInput = z.infer<typeof updateSsoProviderSchema>;

export { registerAzureSsoProviderSchema, updateSsoProviderSchema, verifySsoDomainSchema };
export type { RegisterAzureSsoProviderInput, UpdateSsoProviderInput, VerifySsoDomainInput };
