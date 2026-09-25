import { BROWSER_CHANNELS, type Result } from '../../preload/bridge.ts';
import { envelope } from './result.ts';

export { BROWSER_CHANNELS };

export interface BrowserIpcSender {
  readonly id: number;
}

export interface BrowserHandlers {
  register(sender: BrowserIpcSender, input: unknown): Promise<Result<null>>;
  activate(sender: BrowserIpcSender, chatId: unknown, browserId: unknown): Promise<Result<null>>;
  deactivate(sender: BrowserIpcSender, chatId: unknown): Promise<Result<null>>;
}

export function browserHandlers(deps: {
  register(sender: BrowserIpcSender, input: unknown): void;
  activate(sender: BrowserIpcSender, chatId: unknown, browserId: unknown): void;
  deactivate(sender: BrowserIpcSender, chatId: unknown): void;
}): BrowserHandlers {
  return {
    register: (sender, input) =>
      envelope(async () => {
        if (typeof input !== 'object' || input === null) {
          throw new Error('That browser guest registration is invalid.');
        }
        deps.register(
          sender,
          input as {
            browserId: unknown;
            chatId: unknown;
            webContentsId: unknown;
          },
        );
        return null;
      }),
    activate: (sender, chatId, browserId) =>
      envelope(async () => {
        deps.activate(sender, chatId, browserId);
        return null;
      }),
    deactivate: (sender, chatId) =>
      envelope(async () => {
        deps.deactivate(sender, chatId);
        return null;
      }),
  };
}
