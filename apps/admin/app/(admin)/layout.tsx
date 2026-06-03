import type { ReactNode } from "react";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AdminShell } from "@/features/admin-shell/components/AdminShell";
import { auth } from "@/lib/auth/auth";

type AdminLayoutProperties = {
  children: ReactNode;
};

export default async function AdminLayout({ children }: AdminLayoutProperties) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (session === null) {
    redirect("/sign-in");
  }

  return <AdminShell>{children}</AdminShell>;
}
