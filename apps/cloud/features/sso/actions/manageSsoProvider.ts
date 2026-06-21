import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { eq } from "drizzle-orm";

import type { SsoActionResult } from "@/features/sso/types";
import type {
  RegisterAzureSsoProviderInput,
  UpdateSsoProviderInput,
  VerifySsoDomainInput,
} from "@/features/sso/validation/ssoProvider";

import {
  registerAzureSsoProviderSchema,
  updateSsoProviderSchema,
  verifySsoDomainSchema,
} from "@/features/sso/validation/ssoProvider";
import { auth } from "@/lib/auth/auth";
import { requireOrgRole, requirePlatformAdmin } from "@/lib/auth/guards";
import { organization, ssoProvider } from "@/lib/db/auth-schema";
import { db } from "@/lib/db/postgres";
function providerIdForOrganizationSlug(organizationSlug: string) {
  return `${organizationSlug}-entra`;
}

function azureIssuer(tenantId: string) {
  return `https://login.microsoftonline.com/${tenantId}/v2.0`;
}

function domainVerificationRecord(providerId: string, token: string) {
  const identifier = `_better-auth-token-${providerId}`;

  return {
    host: identifier,
    value: `${identifier}=${token}`,
  };
}

function success(
  message: string,
  record?: ReturnType<typeof domainVerificationRecord>,
): SsoActionResult {
  if (record === undefined) {
    return { status: "success", message };
  }

  return { status: "success", message, domainVerificationRecord: record };
}

function failure(error: unknown): SsoActionResult {
  if (error instanceof Error) {
    return { status: "error", message: error.message };
  }

  return { status: "error", message: "Single sign-on operation failed." };
}

async function requireOrganization(organizationId: string, organizationSlug: string) {
  const [row] = await db
    .select({ id: organization.id, slug: organization.slug })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);

  if (row === undefined) {
    throw new Error("Organization was not found.");
  }

  if (row.slug !== organizationSlug) {
    throw new Error("Organization slug does not match the organization.");
  }
}

const registerAzureSsoProviderAction = createServerFn({ method: "POST" })
  .validator((input: RegisterAzureSsoProviderInput) => input)
  .handler(async ({ data: input }): Promise<SsoActionResult> => {
    try {
      await requirePlatformAdmin();
      const requestHeaders = getRequest().headers;
      const parsedInput = registerAzureSsoProviderSchema.parse(input);
      await requireOrganization(parsedInput.organizationId, parsedInput.organizationSlug);

      const providerId = providerIdForOrganizationSlug(parsedInput.organizationSlug);

      const registeredProvider = await auth.api.registerSSOProvider({
        headers: requestHeaders,
        body: {
          providerId,
          issuer: azureIssuer(parsedInput.tenantId),
          domain: parsedInput.domain,
          organizationId: parsedInput.organizationId,
          oidcConfig: {
            clientId: parsedInput.clientId,
            clientSecret: parsedInput.clientSecret,
            scopes: ["openid", "email", "profile"],
            pkce: true,
          },
        },
      });

      return success(
        "Registered Azure Entra ID single sign-on provider. Add the TXT record below, then verify the domain.",
        domainVerificationRecord(providerId, registeredProvider.domainVerificationToken),
      );
    } catch (error) {
      return failure(error);
    }
  });

const requestSsoDomainVerificationAction = createServerFn({ method: "POST" })
  .validator((input: VerifySsoDomainInput) => input)
  .handler(async ({ data: input }): Promise<SsoActionResult> => {
    try {
      await requirePlatformAdmin();
      const requestHeaders = getRequest().headers;
      const parsedInput = verifySsoDomainSchema.parse(input);

      const verification = await auth.api.requestDomainVerification({
        headers: requestHeaders,
        body: { providerId: parsedInput.providerId },
      });

      return success(
        "Created a new SSO domain verification TXT record.",
        domainVerificationRecord(parsedInput.providerId, verification.domainVerificationToken),
      );
    } catch (error) {
      return failure(error);
    }
  });

const verifySsoDomainAction = createServerFn({ method: "POST" })
  .validator((input: VerifySsoDomainInput) => input)
  .handler(async ({ data: input }): Promise<SsoActionResult> => {
    try {
      await requirePlatformAdmin();
      const requestHeaders = getRequest().headers;
      const parsedInput = verifySsoDomainSchema.parse(input);

      await auth.api.verifyDomain({
        headers: requestHeaders,
        body: { providerId: parsedInput.providerId },
      });

      return success("Verified SSO email domain.");
    } catch (error) {
      return failure(error);
    }
  });

const updateSsoProviderAction = createServerFn({ method: "POST" })
  .validator((input: UpdateSsoProviderInput) => input)
  .handler(async ({ data: input }): Promise<SsoActionResult> => {
    try {
      await requireOrgRole(input.organizationId);
      const parsedInput = updateSsoProviderSchema.parse(input);

      const [existing] = await db
        .select({ oidcConfig: ssoProvider.oidcConfig })
        .from(ssoProvider)
        .where(eq(ssoProvider.providerId, parsedInput.providerId))
        .limit(1);

      if (existing === undefined) {
        return failure(new Error("SSO provider not found."));
      }

      const existingConfig: Record<string, unknown> = existing.oidcConfig
        ? JSON.parse(existing.oidcConfig)
        : {};

      const mergedConfig = {
        ...existingConfig,
        clientId: parsedInput.clientId,
        ...(parsedInput.clientSecret && { clientSecret: parsedInput.clientSecret }),
      };

      await db
        .update(ssoProvider)
        .set({
          oidcConfig: JSON.stringify(mergedConfig),
          domain: parsedInput.domain,
        })
        .where(eq(ssoProvider.providerId, parsedInput.providerId));

      return success("Updated SSO provider configuration.");
    } catch (error) {
      return failure(error);
    }
  });

export {
  updateSsoProviderAction,
  registerAzureSsoProviderAction,
  requestSsoDomainVerificationAction,
  verifySsoDomainAction,
};
