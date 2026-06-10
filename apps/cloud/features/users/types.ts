type PlatformUserStatus = "active" | "suspended";

type PlatformUser = {
  id: string;
  name: string;
  email: string;
  platformRole: string;
  organizationCount: number;
  status: PlatformUserStatus;
  createdAt: string;
};

export type { PlatformUser, PlatformUserStatus };
