"use client";

import type { ReactNode } from "react";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

type AdminBreadcrumbItem = {
  label: string;
  href?: string;
};

type AdminBreadcrumbContextValue = {
  items: AdminBreadcrumbItem[] | undefined;
  setItems: (items: AdminBreadcrumbItem[] | undefined) => void;
};

const AdminBreadcrumbContext = createContext<AdminBreadcrumbContextValue | undefined>(undefined);

type AdminBreadcrumbProviderProperties = {
  children: ReactNode;
};

function AdminBreadcrumbProvider({ children }: AdminBreadcrumbProviderProperties) {
  const [items, setItems] = useState<AdminBreadcrumbItem[]>();

  const value = useMemo(
    () => ({
      items,
      setItems,
    }),
    [items],
  );

  return (
    <AdminBreadcrumbContext.Provider value={value}>{children}</AdminBreadcrumbContext.Provider>
  );
}

function useAdminBreadcrumbs() {
  const context = useContext(AdminBreadcrumbContext);

  if (context === undefined) {
    throw new Error("useAdminBreadcrumbs must be used within AdminBreadcrumbProvider.");
  }

  return context;
}

type AdminBreadcrumbSetterProperties = {
  items: AdminBreadcrumbItem[];
};

function AdminBreadcrumbSetter({ items }: AdminBreadcrumbSetterProperties) {
  const { setItems } = useAdminBreadcrumbs();

  useEffect(() => {
    setItems(items);

    return () => setItems(undefined);
  }, [items, setItems]);

  return <></>;
}

export { AdminBreadcrumbProvider, AdminBreadcrumbSetter, useAdminBreadcrumbs };
export type { AdminBreadcrumbItem };
