import { UPDATE_CHANNELS, type DesktopUpdateSnapshot, type Result } from '../../preload/bridge.ts';
import { envelope } from './result.ts';

export { UPDATE_CHANNELS };

export interface UpdatesDeps {
  snapshot(): DesktopUpdateSnapshot;
  check(): Promise<DesktopUpdateSnapshot>;
  install(): Promise<{ installed: boolean; message: string }>;
}

export interface UpdatesHandlers {
  load(): Promise<Result<DesktopUpdateSnapshot>>;
  check(): Promise<Result<DesktopUpdateSnapshot>>;
  install(): Promise<Result<{ installed: boolean; message: string }>>;
}

export function updatesHandlers(deps: UpdatesDeps): UpdatesHandlers {
  return {
    load: () => envelope(async () => deps.snapshot()),
    check: () => envelope(() => deps.check()),
    install: () => envelope(() => deps.install()),
  };
}
