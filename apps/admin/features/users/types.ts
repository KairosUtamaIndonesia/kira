type PlatformUser = {
  id: string;
  name: string;
  email: string;
  platformRole: "platform_admin" | "platform_support" | "user";
  organizationCount: number;
  status: "active" | "invited" | "suspended";
  createdAt: string;
};

export type { PlatformUser };
