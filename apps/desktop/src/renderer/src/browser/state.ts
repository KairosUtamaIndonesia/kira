export interface BrowserTab {
  id: string;
  url: string;
  title: string;
}

export interface BrowserTabs {
  tabs: BrowserTab[];
  activeId: string | null;
}

export type BrowsersByChat = Readonly<Record<string, BrowserTabs>>;

export function emptyBrowserTabs(): BrowserTabs {
  return { tabs: [], activeId: null };
}

export function browsersOf(all: BrowsersByChat, chatId: string): BrowserTabs {
  return all[chatId] ?? emptyBrowserTabs();
}

export function openedBrowser(
  all: BrowsersByChat,
  chatId: string,
  tab: BrowserTab,
): BrowsersByChat {
  const current = browsersOf(all, chatId);
  const tabs = current.tabs.some((each) => each.id === tab.id)
    ? current.tabs.map((each) => (each.id === tab.id ? tab : each))
    : [...current.tabs, tab];

  return { ...all, [chatId]: { tabs, activeId: tab.id } };
}

export function showingBrowser(
  all: BrowsersByChat,
  chatId: string,
  browserId: string,
): BrowsersByChat {
  const current = browsersOf(all, chatId);
  if (!current.tabs.some((each) => each.id === browserId)) return all;

  return { ...all, [chatId]: { ...current, activeId: browserId } };
}

export function updatedBrowser(
  all: BrowsersByChat,
  chatId: string,
  tab: BrowserTab,
): BrowsersByChat {
  const current = browsersOf(all, chatId);
  if (!current.tabs.some((each) => each.id === tab.id)) return all;

  return {
    ...all,
    [chatId]: { ...current, tabs: current.tabs.map((each) => (each.id === tab.id ? tab : each)) },
  };
}

export function closedBrowser(
  all: BrowsersByChat,
  chatId: string,
  browserId: string,
): BrowsersByChat {
  const current = browsersOf(all, chatId);
  const at = current.tabs.findIndex((each) => each.id === browserId);
  if (at === -1) return all;

  const tabs = current.tabs.filter((each) => each.id !== browserId);
  const neighbour = tabs[at] ?? tabs[at - 1] ?? null;
  return {
    ...all,
    [chatId]: {
      tabs,
      activeId: current.activeId === browserId ? (neighbour?.id ?? null) : current.activeId,
    },
  };
}

export function normalizedBrowserUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  let candidate = trimmed;
  if (trimmed.startsWith('//')) candidate = `https:${trimmed}`;
  else if (!/^[a-z][a-z\d+.-]*:/i.test(trimmed)) candidate = `https://${trimmed}`;

  try {
    const url = new URL(candidate);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function pageLoadFailureMessage(event: {
  errorCode?: unknown;
  isMainFrame?: unknown;
  errorDescription?: unknown;
}): string | null {
  if (event.errorCode === -3 || event.isMainFrame !== true) return null;
  return typeof event.errorDescription === 'string'
    ? event.errorDescription
    : 'The page could not be loaded.';
}

export function browsersForPersistence(all: BrowsersByChat): BrowsersByChat {
  const result: Record<string, BrowserTabs> = {};
  for (const [chatId, state] of Object.entries(all)) {
    const tabs = state.tabs.filter(
      (tab) =>
        typeof tab.id === 'string' &&
        typeof tab.title === 'string' &&
        normalizedBrowserUrl(tab.url) !== null,
    );
    const activeId =
      state.activeId !== null && tabs.some((tab) => tab.id === state.activeId)
        ? state.activeId
        : (tabs[0]?.id ?? null);
    result[chatId] = { tabs, activeId };
  }
  return result;
}

export function browsersFromPersistence(value: unknown): BrowsersByChat {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const parsed: Record<string, BrowserTabs> = {};
  for (const [chatId, candidate] of Object.entries(value)) {
    if (typeof candidate !== 'object' || candidate === null || !('tabs' in candidate)) continue;
    const tabsValue = (candidate as { tabs?: unknown }).tabs;
    if (!Array.isArray(tabsValue)) continue;
    const tabs = tabsValue.flatMap((item): BrowserTab[] => {
      if (typeof item !== 'object' || item === null) return [];
      const tab = item as Partial<BrowserTab>;
      const url = typeof tab.url === 'string' ? normalizedBrowserUrl(tab.url) : null;
      if (typeof tab.id !== 'string' || typeof tab.title !== 'string' || url === null) return [];
      return [{ id: tab.id, title: tab.title, url }];
    });
    const activeId = (candidate as { activeId?: unknown }).activeId;
    parsed[chatId] = {
      tabs,
      activeId:
        typeof activeId === 'string' && tabs.some((tab) => tab.id === activeId)
          ? activeId
          : (tabs[0]?.id ?? null),
    };
  }
  return parsed;
}
