import { app } from 'electron';
import { createRequire } from 'node:module';
import { createDesktopUpdates, UPDATE_FEED_URL, type DesktopUpdateRuntime } from './updates.ts';

const { autoUpdater } = createRequire(import.meta.url)('electron-updater') as typeof import(
  'electron-updater'
);

const runtime: DesktopUpdateRuntime = {
  async checkForUpdates() {
    const result = await autoUpdater.checkForUpdates();
    return result
      ? {
          isUpdateAvailable: result.isUpdateAvailable,
          version: result.updateInfo.version,
        }
      : null;
  },
  quitAndInstall() {
    autoUpdater.quitAndInstall(false, true);
  },
  onUpdateAvailable(callback) {
    autoUpdater.on('update-available', (info) => callback(info.version));
  },
  onUpdateDownloaded(callback) {
    autoUpdater.on('update-downloaded', (info) => callback(info.version));
  },
  onUpdateNotAvailable(callback) {
    autoUpdater.on('update-not-available', callback);
  },
  onError(callback) {
    autoUpdater.on('error', (error) => callback(error.message));
  },
};

autoUpdater.setFeedURL({ provider: 'generic', url: UPDATE_FEED_URL });
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = false;

export const desktopUpdates = createDesktopUpdates({
  runtime,
  isPackaged: app.isPackaged,
  platform: process.platform,
  isAppImage: Boolean(process.env.APPIMAGE),
  currentVersion: app.getVersion(),
});
