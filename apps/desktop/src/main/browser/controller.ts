import { shell, session, webContents, type WebContents } from 'electron';
import { BROWSER_PROFILE_PARTITION } from '../../preload/bridge.ts';
import { browserUrlIn, browserValueIn } from './security.ts';

interface BrowserRegistration {
  browserId: string;
  chatId: string;
  hostId: number;
  guest: WebContents;
}

export type BrowserOperation =
  | { action: 'navigate'; url: string }
  | { action: 'snapshot' }
  | { action: 'click'; selector: string }
  | { action: 'fill'; selector: string; text: string }
  | { action: 'screenshot' };

const registrations = new Map<string, BrowserRegistration>();
const activeByChat = new Map<string, string>();

function key(hostId: number, browserId: string): string {
  return `${hostId}:${browserId}`;
}

function safePageUrl(value: string | undefined): boolean {
  return value === 'about:blank' || browserUrlIn(value) !== null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Main-process owner of embedded browser guests.
 *
 * Guest identity crosses from the window only as an id. It is resolved back to
 * Electron's WebContents and accepted only when Electron says that guest belongs
 * to the calling host window and the one persistent browser profile.
 */
export class BrowserController {
  attachHost(host: WebContents): void {
    host.on('will-attach-webview', (event, preferences, params) => {
      if (!safePageUrl(params.src)) {
        event.preventDefault();
        return;
      }

      preferences.nodeIntegration = false;
      preferences.contextIsolation = true;
      preferences.sandbox = true;
      preferences.webSecurity = true;
      preferences.allowRunningInsecureContent = false;
      preferences.preload = '';
      params.partition = BROWSER_PROFILE_PARTITION;
      delete params.allowpopups;
    });

    host.on('did-attach-webview', (_event, guest) => {
      guest.on('will-navigate', (event, url) => {
        if (!safePageUrl(url)) event.preventDefault();
      });
      guest.on('will-redirect', (event, url) => {
        if (!safePageUrl(url)) event.preventDefault();
      });
      guest.setWindowOpenHandler(({ url }) => {
        const safe = browserUrlIn(url);
        if (safe !== null) void shell.openExternal(safe);
        return { action: 'deny' };
      });
      guest.once('destroyed', () => this.forgetGuest(guest.id));
    });

    host.once('destroyed', () => {
      for (const [id, registration] of registrations) {
        if (registration.hostId === host.id) registrations.delete(id);
      }
      for (const id of activeByChat.keys()) {
        const browserId = activeByChat.get(id);
        if (browserId?.startsWith(`${host.id}:`)) activeByChat.delete(id);
      }
    });
  }

  register(
    sender: WebContents,
    input: { browserId: unknown; chatId: unknown; webContentsId: unknown },
  ): void {
    const { browserId, chatId, webContentsId } = input;
    if (
      typeof browserId !== 'string' ||
      browserId.length === 0 ||
      browserId.length > 200 ||
      typeof chatId !== 'string' ||
      chatId.length === 0 ||
      chatId.length > 200 ||
      typeof webContentsId !== 'number' ||
      !Number.isSafeInteger(webContentsId)
    ) {
      throw new Error('That browser guest registration is invalid.');
    }

    const guest = webContents.fromId(webContentsId);
    if (
      !guest ||
      guest.isDestroyed() ||
      guest.hostWebContents !== sender ||
      guest.session !== session.fromPartition(BROWSER_PROFILE_PARTITION)
    ) {
      throw new Error('That browser guest does not belong to this window.');
    }

    registrations.set(key(sender.id, browserId), {
      browserId,
      chatId,
      hostId: sender.id,
      guest,
    });
  }

  activate(sender: WebContents, chatId: unknown, browserId: unknown): void {
    if (typeof chatId !== 'string' || chatId.length === 0 || typeof browserId !== 'string') {
      throw new Error('That browser selection is invalid.');
    }
    const registration = registrations.get(key(sender.id, browserId));
    if (!registration || registration.chatId !== chatId) {
      throw new Error('That browser is not open in this chat.');
    }
    activeByChat.set(chatId, key(sender.id, browserId));
  }

  deactivate(sender: WebContents, chatId: unknown): void {
    if (typeof chatId !== 'string') return;
    if (!activeByChat.get(chatId)?.startsWith(`${sender.id}:`)) return;
    activeByChat.delete(chatId);
  }

  async operate(chatId: string, operation: BrowserOperation): Promise<unknown> {
    const browserId = activeByChat.get(chatId);
    const registration = browserId === undefined ? undefined : registrations.get(browserId);
    const guest = registration?.guest;
    if (!guest || registration?.chatId !== chatId || guest.isDestroyed()) {
      throw new Error('Open a browser tab in this chat before using browser tools.');
    }

    if (operation.action === 'navigate') {
      const url = browserUrlIn(operation.url);
      if (url === null) throw new Error('Browser navigation only supports HTTP and HTTPS URLs.');
      await guest.loadURL(url);
      return `Opened ${url}`;
    }
    if (operation.action === 'screenshot') {
      const image = await guest.capturePage();
      return { type: 'image', data: image.toDataURL().split(',')[1], mimeType: 'image/png' };
    }
    if (operation.action === 'snapshot') {
      return guest.executeJavaScript(
        `({title:document.title,url:location.href,text:(document.body?.innerText??'').slice(0,12000)})`,
      );
    }

    const selector = browserValueIn(operation.selector);
    if (selector === null || selector.trim() === '') {
      throw new Error('A CSS selector is required and must be under 10,000 characters.');
    }
    if (operation.action === 'click') {
      return guest.executeJavaScript(`(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!(element instanceof HTMLElement)) throw new Error('No matching page element.');
        element.click();
        return 'Clicked ' + ${JSON.stringify(selector)};
      })()`);
    }

    const text = browserValueIn(operation.text);
    if (text === null) throw new Error('Text must be under 10,000 characters.');
    return guest.executeJavaScript(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
        throw new Error('The selector must match a text input or textarea.');
      }
      element.focus();
      element.value = ${JSON.stringify(text)};
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return 'Filled ' + ${JSON.stringify(selector)};
    })()`);
  }

  private forgetGuest(guestId: number): void {
    for (const [id, registration] of registrations) {
      if (registration.guest.id !== guestId) continue;
      registrations.delete(id);
      if (activeByChat.get(registration.chatId) === id) activeByChat.delete(registration.chatId);
    }
  }
}

const browserController = new BrowserController();

export function browserForWindow(): BrowserController {
  return browserController;
}

export function describeBrowserFailure(error: unknown): string {
  return messageOf(error);
}
