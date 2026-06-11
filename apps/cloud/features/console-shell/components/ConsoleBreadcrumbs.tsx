"use client";

import type { ReactNode } from "react";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

type ConsoleBreadcrumbItem = {
  label: string;
  href?: string;
};

type ConsoleBreadcrumbContextValue = {
  items: ConsoleBreadcrumbItem[] | undefined;
  setItems: (items: ConsoleBreadcrumbItem[] | undefined) => void;
};

const ConsoleBreadcrumbContext = createContext<ConsoleBreadcrumbContextValue | undefined>(
  undefined,
);

type ConsoleBreadcrumbProviderProperties = {
  children: ReactNode;
};

function ConsoleBreadcrumbProvider({ children }: ConsoleBreadcrumbProviderProperties) {
  const [items, setItems] = useState<ConsoleBreadcrumbItem[]>();

  const value = useMemo(
    () => ({
      items,
      setItems,
    }),
    [items],
  );

  return (
    <ConsoleBreadcrumbContext.Provider value={value}>{children}</ConsoleBreadcrumbContext.Provider>
  );
}

function useConsoleBreadcrumbs() {
  const context = useContext(ConsoleBreadcrumbContext);

  if (context === undefined) {
    throw new Error("useConsoleBreadcrumbs must be used within ConsoleBreadcrumbProvider.");
  }

  return context;
}

type ConsoleBreadcrumbSetterProperties = {
  items: ConsoleBreadcrumbItem[];
};

function ConsoleBreadcrumbSetter({ items }: ConsoleBreadcrumbSetterProperties) {
  const { setItems } = useConsoleBreadcrumbs();

  useEffect(() => {
    setItems(items);

    return () => setItems(undefined);
  }, [items, setItems]);

  return <></>;
}

export { ConsoleBreadcrumbProvider, ConsoleBreadcrumbSetter, useConsoleBreadcrumbs };
export type { ConsoleBreadcrumbItem };
