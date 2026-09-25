import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Plus, X } from 'lucide-react';
import * as stylex from '@stylexjs/stylex';
import {
  browsersOf,
  type BrowsersByChat,
  type BrowserTab,
  closedBrowser,
  openedBrowser,
  showingBrowser,
  updatedBrowser,
} from './state';
import { BrowserPane } from './BrowserPane';
import { styles } from './styles';

function labelOf(browser: BrowserTab): string {
  if (browser.title.trim()) return browser.title;
  try {
    return new URL(browser.url).hostname || browser.url;
  } catch {
    return browser.url;
  }
}

export function BrowserWorkspace({
  chatId,
  showing,
  browsers,
  onChange,
}: {
  chatId: string;
  showing: boolean;
  browsers: BrowsersByChat;
  onChange: (next: BrowsersByChat) => void;
}) {
  const current = browsersOf(browsers, chatId);
  const active = current.tabs.find((tab) => tab.id === current.activeId) ?? null;

  const add = (): void => {
    const tab: BrowserTab = {
      id: crypto.randomUUID(),
      url: 'https://example.com/',
      title: '',
    };
    onChange(openedBrowser(browsers, chatId, tab));
    void window.kira.activateBrowser(chatId, tab.id);
  };

  const select = (browserId: string): void => {
    onChange(showingBrowser(browsers, chatId, browserId));
    void window.kira.activateBrowser(chatId, browserId);
  };

  const close = (browserId: string): void => {
    const next = closedBrowser(browsers, chatId, browserId);
    onChange(next);
    const selected = browsersOf(next, chatId).activeId;
    if (selected) void window.kira.activateBrowser(chatId, selected);
    else void window.kira.deactivateBrowser(chatId);
  };

  const update = (ownerChatId: string, browserId: string, patch: Partial<BrowserTab>): void => {
    const held = browsersOf(browsers, ownerChatId);
    const tab = held.tabs.find((each) => each.id === browserId);
    if (!tab) return;
    onChange(updatedBrowser(browsers, ownerChatId, { ...tab, ...patch }));
  };

  return (
    <div {...stylex.props(styles.workspace)}>
      <div {...stylex.props(styles.strip)} role="tablist" aria-label="Browser tabs">
        {current.tabs.map((tab) => (
          <div {...stylex.props(styles.tab)} key={tab.id}>
            <button
              type="button"
              role="tab"
              aria-selected={tab.id === current.activeId}
              {...stylex.props(
                styles.tabSelect,
                tab.id === current.activeId ? styles.selectedTab : null,
              )}
              onClick={() => select(tab.id)}
            >
              {labelOf(tab)}
            </button>
            <IconButton
              label={`Close ${labelOf(tab)}`}
              tooltip={`Close ${labelOf(tab)}`}
              icon={<Icon icon={X} size="sm" />}
              size="sm"
              variant="ghost"
              onClick={() => close(tab.id)}
            />
          </div>
        ))}
        <IconButton
          label="New browser tab"
          tooltip="New browser tab"
          icon={<Icon icon={Plus} size="sm" />}
          size="sm"
          variant="ghost"
          onClick={add}
        />
      </div>
      <div {...stylex.props(styles.pages)}>
        {Object.entries(browsers).flatMap(([ownerChatId, tabs]) =>
          tabs.tabs.map((tab) => (
            <BrowserPane
              key={`${ownerChatId}:${tab.id}`}
              browser={tab}
              chatId={ownerChatId}
              active={showing && ownerChatId === chatId && tab.id === active?.id}
              onUpdate={(patch) => update(ownerChatId, tab.id, patch)}
            />
          )),
        )}
        {active === null ? (
          <div {...stylex.props(styles.empty)}>
            <p>No browser tab is open for this chat.</p>
            <IconButton
              label="Open browser"
              tooltip="Open browser"
              icon={<Icon icon={Plus} size="sm" />}
              size="sm"
              variant="secondary"
              onClick={add}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
