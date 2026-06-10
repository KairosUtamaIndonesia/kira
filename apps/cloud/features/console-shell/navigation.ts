import type { ComponentType, SVGProps } from "react";

import { Building2, LayoutDashboard, Settings, Users } from "lucide-react";

type PrimaryNavigationRoute = "/dashboard" | "/organizations" | "/users" | "/settings";

type NavigationIcon = ComponentType<SVGProps<SVGSVGElement>>;

type PrimaryNavigationItem = {
  to: PrimaryNavigationRoute;
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

export { primaryNavigation };
export type { PrimaryNavigationItem };
