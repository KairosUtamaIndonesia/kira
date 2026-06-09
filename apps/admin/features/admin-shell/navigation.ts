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

type NavigationItem = {
  href: string;
  label: string;
  description: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
};

const primaryNavigation: NavigationItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    description: "SaaS operations overview",
    icon: LayoutDashboard,
  },
  {
    href: "/organizations",
    label: "Organizations",
    description: "Manage customer workspaces",
    icon: Building2,
  },
  {
    href: "/users",
    label: "Users",
    description: "Manage platform accounts",
    icon: Users,
  },
  {
    href: "/settings",
    label: "Settings",
    description: "Admin configuration",
    icon: Settings,
  },
];

const organizationNavigation: NavigationItem[] = [
  {
    href: "",
    label: "Overview",
    description: "Organization summary",
    icon: Building2,
  },
  {
    href: "members",
    label: "Members",
    description: "Organization users and roles",
    icon: Users,
  },
  {
    href: "api-keys",
    label: "API Keys",
    description: "Desktop access credentials",
    icon: KeyRound,
  },
  {
    href: "models",
    label: "Models",
    description: "Organization AI models",
    icon: BrainCircuit,
  },
  {
    href: "access-control",
    label: "Access Control",
    description: "Role permissions",
    icon: ShieldCheck,
  },
  {
    href: "settings",
    label: "Settings",
    description: "Organization settings",
    icon: Settings,
  },
];

export { organizationNavigation, primaryNavigation };
export type { NavigationItem };
