import type { ComponentType, SVGProps } from "react";

import {
  BrainCircuit,
  Building2,
  KeyRound,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";

type PrimaryNavigationRoute = "/dashboard" | "/organizations" | "/users" | "/settings";

type OrganizationNavigationRoute =
  | "/organizations/$organizationId"
  | "/organizations/$organizationId/members"
  | "/organizations/$organizationId/api-keys"
  | "/organizations/$organizationId/models"
  | "/organizations/$organizationId/access-control"
  | "/organizations/$organizationId/settings";

type NavigationIcon = ComponentType<SVGProps<SVGSVGElement>>;

type PrimaryNavigationItem = {
  to: PrimaryNavigationRoute;
  label: string;
  description: string;
  icon: NavigationIcon;
};

type OrganizationNavigationItem = {
  to: OrganizationNavigationRoute;
  label: string;
  description: string;
  icon: NavigationIcon;
};

const primaryNavigation: PrimaryNavigationItem[] = [
  {
    to: "/dashboard",
    label: "Dashboard",
    description: "SaaS operations overview",
    icon: LayoutDashboard,
  },
  {
    to: "/organizations",
    label: "Organizations",
    description: "Manage customer workspaces",
    icon: Building2,
  },
  {
    to: "/users",
    label: "Users",
    description: "Manage platform accounts",
    icon: Users,
  },
  {
    to: "/settings",
    label: "Settings",
    description: "Admin configuration",
    icon: Settings,
  },
];

const organizationNavigation: OrganizationNavigationItem[] = [
  {
    to: "/organizations/$organizationId",
    label: "Overview",
    description: "Organization summary",
    icon: Building2,
  },
  {
    to: "/organizations/$organizationId/members",
    label: "Members",
    description: "Organization users and roles",
    icon: Users,
  },
  {
    to: "/organizations/$organizationId/api-keys",
    label: "API Keys",
    description: "Desktop access credentials",
    icon: KeyRound,
  },
  {
    to: "/organizations/$organizationId/models",
    label: "Models",
    description: "Organization AI models",
    icon: BrainCircuit,
  },
  {
    to: "/organizations/$organizationId/access-control",
    label: "Access Control",
    description: "Role permissions",
    icon: ShieldCheck,
  },
  {
    to: "/organizations/$organizationId/settings",
    label: "Settings",
    description: "Organization settings",
    icon: Settings,
  },
];

export { organizationNavigation, primaryNavigation };
export type { OrganizationNavigationItem, PrimaryNavigationItem };
