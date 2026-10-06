import { createContext, type ReactNode, useContext } from 'react';
import type { Readings } from './api/allowances';
import type { Who } from './api/auth';
import type { ListedUser } from './api/users';

/** What the console read before it drew, and the one way a screen may change it. */
export interface ConsoleData {
  who: Who;
  users: ListedUser[];
  readings: Readings;
  /** Apply a change the server accepted, so every screen agrees with it. */
  updateUser: (changed: Partial<ListedUser> & { id: string }) => void;
}

const ConsoleDataContext = createContext<ConsoleData | null>(null);

export function ConsoleDataProvider({
  value,
  children,
}: {
  value: ConsoleData;
  children: ReactNode;
}) {
  return <ConsoleDataContext.Provider value={value}>{children}</ConsoleDataContext.Provider>;
}

/** The opening data, for a screen drawn inside the console. */
export function useConsoleData(): ConsoleData {
  const value = useContext(ConsoleDataContext);
  if (value === null) throw new Error('A console screen was drawn outside the console');
  return value;
}
