import type { DesktopUpdateSnapshot } from '../../../preload/bridge';

export function desktopUpdateStatusText(snapshot: DesktopUpdateSnapshot | null): string {
  if (snapshot === null || snapshot.status === 'checking') return 'Checking for updates…';

  switch (snapshot.status) {
    case 'unsupported':
      return 'Updates are not available for this installation.';
    case 'up-to-date':
      return 'Kira is up to date.';
    case 'downloading':
      return `Downloading version ${snapshot.availableVersion ?? ''}…`;
    case 'downloaded':
      return `Version ${snapshot.availableVersion ?? ''} is ready to install.`;
    case 'installing':
      return 'Restarting to install the update…';
    case 'error':
      return `Could not check for updates: ${snapshot.error ?? 'Unknown error.'}`;
    case 'idle':
      return 'Updates will be checked automatically.';
  }
}

export function canCheckDesktopUpdate(snapshot: DesktopUpdateSnapshot | null): boolean {
  return (
    snapshot?.status !== 'unsupported' &&
    snapshot?.status !== 'checking' &&
    snapshot?.status !== 'downloading' &&
    snapshot?.status !== 'installing'
  );
}
