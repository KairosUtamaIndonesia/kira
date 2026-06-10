import type { ComponentType, SVGProps } from "react";

import { BrainCircuit, Building2, KeyRound, Settings, ShieldCheck, Users } from "lucide-react";

type OrgAdminNavigationRoute =
  | "/org/$organizationId"
  | "/org/$organizationId/members"
  | "/org/$organizationId/api-keys"
  | "/org/$organizationId/models"
  | "/org/$organizationId/access-control"
  | "/org/$organizationId/settings";

type NavigationIcon = ComponentType<SVGProps<SVGSVGElement>>;

type OrgAdminNavigationItem = {
  to: OrgAdminNavigationRoute;
  label: string;
  description: string;
  icon: NavigationIcon;
};

const orgAdminNavigation: OrgAdminNavigationItem[] = [
  {
    to: "/org/$organizationId",
    label: "Overview",
    description: "Organization summary",
    icon: Building2,
  },
  {
    to: "/org/$organizationId/members",
    label: "Members",
    description: "Organization users and roles",
    icon: Users,
  },
  {
    to: "/org/$organizationId/api-keys",
    label: "API Keys",
    description: "Desktop access credentials",
    icon: KeyRound,
  },
  {
    to: "/org/$organizationId/models",
    label: "Models",
    description: "Organization AI models",
    icon: BrainCircuit,
  },
  {
    to: "/org/$organizationId/access-control",
    label: "Access Control",
    description: "Role permissions",
    icon: ShieldCheck,
  },
  {
    to: "/org/$organizationId/settings",
    label: "Settings",
    description: "Organization settings",
    icon: Settings,
  },
];

export { orgAdminNavigation };
export type { OrgAdminNavigationItem };
