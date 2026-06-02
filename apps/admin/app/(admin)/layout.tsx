import type { ReactNode } from "react";

import { AdminShell } from "@/features/admin-shell/components/AdminShell";

type AdminLayoutProperties = {
  children: ReactNode;
};

export default function AdminLayout({ children }: AdminLayoutProperties) {
  return <AdminShell>{children}</AdminShell>;
}
