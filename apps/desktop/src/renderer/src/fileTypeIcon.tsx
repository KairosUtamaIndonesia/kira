/**
 * The icon that stands for a row of the tree: what kind of file it is.
 *
 * The vocabulary is `material-icon-theme`'s — the VS Code Material Icon Theme —
 * bundled whole rather than sampled, and drawn at the size the tree's own glyphs
 * were (Astryx's `sm`, which is 1rem). `fileIcons` decides which of the theme's
 * names a row wants; this resolves that name to the theme's file and draws it.
 *
 * The SVGs come in as files rather than as data: they average under a kilobyte, so
 * Vite would otherwise fold a thousand of them into the bundle as base64, where
 * the window would carry every icon it never draws. As files, it fetches the
 * handful it is drawing.
 */
import * as stylex from '@stylexjs/stylex';
import { useSyncExternalStore } from 'react';
import { type IconKind, type IconScheme, iconFileFor, iconNameFor } from './fileIcons';

const styles = stylex.create({
  icon: {
    display: 'block',
    flexShrink: 0,
    width: '1rem',
    height: '1rem',
  },
});

/**
 * The theme's icons by file name, each emitted as its own asset.
 *
 * The glob is written from here rather than from the project root because the
 * renderer's root is `src/renderer`, and it is eager because the lookup needs the
 * URLs in hand; the files themselves are fetched only as rows are drawn. It names
 * the app's own `node_modules`, which is where the package lands as a direct
 * devDependency: were that ever to stop being true the glob would match nothing
 * and the rows would draw their labels alone.
 */
const ICON_URLS = new Map(
  Object.entries(
    import.meta.glob('../../../node_modules/material-icon-theme/icons/*.svg', {
      eager: true,
      query: '?url&no-inline',
      import: 'default',
    }) as Record<string, string>,
  ).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1), url]),
);

const DARK = '(prefers-color-scheme: dark)';

/**
 * Which way the app is drawing. Foundry's theme hands this to the system —
 * `color-scheme: light dark` on the root — so the system's answer is the app's.
 */
function schemeNow(): IconScheme {
  return window.matchMedia(DARK).matches ? 'dark' : 'light';
}

function watchScheme(changed: () => void): () => void {
  const media = window.matchMedia(DARK);
  media.addEventListener('change', changed);
  return () => media.removeEventListener('change', changed);
}

/**
 * A row's icon. It is decoration — the row is named by its label — so it is drawn
 * empty for anyone reading by ear, and a name the theme cannot resolve draws
 * nothing rather than a broken image.
 */
export function FileTypeIcon({ name, kind }: { name: string; kind: IconKind }) {
  const scheme = useSyncExternalStore(watchScheme, schemeNow);
  const file = iconFileFor(iconNameFor(name, kind, scheme));
  const url = file === undefined ? undefined : ICON_URLS.get(file);
  if (url === undefined) return null;

  return <img {...stylex.props(styles.icon)} src={url} alt="" />;
}
