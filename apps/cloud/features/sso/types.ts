type OrganizationSsoStatus = "not_configured" | "active" | "pending_domain_verification";

type OrganizationSsoConnection = {
  id: string;
  organizationId: string;
  providerId: string;
  issuer: string;
  domain: string;
  domainVerified: boolean;
  status: OrganizationSsoStatus;
};

type SsoDomainVerificationRecord = {
  host: string;
  value: string;
};

type SsoActionResult = {
  status: "error" | "success";
  message: string;
  domainVerificationRecord?: SsoDomainVerificationRecord;
};

export type {
  OrganizationSsoConnection,
  OrganizationSsoStatus,
  SsoActionResult,
  SsoDomainVerificationRecord,
};
