/**
 * One patch, drawn with the diff library on Kira's existing shiki.
 *
 * The library renders into a shadow root, so Kira's theme cannot reach inside
 * with StyleX. It crosses the boundary the way a custom property does: the host
 * element names the code font and the surface colours in `styles.css`, and the
 * shadow root reads them. Nothing here introduces a second highlighter — the
 * library is built on the shiki the file viewer already uses.
 *
 * The theme and the file's language are loaded before the diff is mounted. The
 * library highlights asynchronously on the main thread, and its first empty
 * render is not always followed by another, so waiting is what keeps a diff from
 * drawing as an empty box until something else redraws it.
 */
import * as diffs from '@pierre/diffs';
import { PatchDiff } from '@pierre/diffs/react';
import { Component, type ReactNode, useEffect, useMemo, useState } from 'react';
import { useKiraAppearance } from '@kira/theme';
import { languageOf } from './filePreview';
import { kiraShikiTheme, type KiraShikiTheme } from './kiraShikiTheme';

/**
 * The library's highlighter preloader, read off its namespace rather than named
 * directly: the package is imported by two entries, and a dev server that has
 * not re-optimised one of them fails a named import hard and takes the window
 * down with it. Read this way, a build without it simply renders and lets the
 * library load its own highlighter.
 */
const preload = (
  diffs as {
    preloadHighlighter?: (options: { themes: string[]; langs: string[] }) => Promise<void>;
  }
).preloadHighlighter;

/** Whether the pane draws its diff inline or in two columns. */
export type DiffStyle = 'unified' | 'split';

/**
 * `patch` is one file's unified diff, and `path` names the file it changed, so
 * the shiki language can be read from its name. `wrap` breaks long lines rather
 * than scrolling them sideways, which is what reading a wide file wants.
 */
export function DiffPatch({
  patch,
  path,
  diffStyle,
  wrap,
}: {
  patch: string;
  path: string;
  diffStyle: DiffStyle;
  wrap: boolean;
}) {
  const appearance = useKiraAppearance();
  const theme = useMemo(
    () => kiraShikiTheme(appearance.mode, appearance.activeTheme?.id, appearance.token),
    [appearance.mode, appearance.activeTheme?.id, appearance.token],
  );
  const language = languageOf(path) ?? 'text';
  const key = `${theme.name}:${language}`;

  return (
    <LoadedDiff
      key={key}
      patch={patch}
      diffStyle={diffStyle}
      wrap={wrap}
      language={language}
      theme={theme}
    />
  );
}

function LoadedDiff({
  patch,
  diffStyle,
  wrap,
  language,
  theme,
}: {
  patch: string;
  diffStyle: DiffStyle;
  wrap: boolean;
  language: string;
  theme: KiraShikiTheme;
}) {
  const [loaded, setLoaded] = useState<string | null>(null);
  const key = `${theme.name}:${language}`;

  useMountEffect(() => {
    let live = true;
    diffs.registerCustomTheme(theme.name, async () => theme);
    const work =
      preload === undefined
        ? Promise.resolve()
        : preload({ themes: [theme.name], langs: [language] });
    void work
      .catch(() => undefined)
      .then(() => {
        if (live) setLoaded(key);
      });

    return () => {
      live = false;
    };
  });

  return (
    <div className="workbench-diff">
      {loaded === key ? (
        <DiffBoundary key={patch}>
          <PatchDiff
            patch={patch}
            disableWorkerPool
            options={{
              theme: theme.name,
              diffStyle,
              overflow: wrap ? 'wrap' : 'scroll',
              disableFileHeader: true,
            }}
          />
        </DiffBoundary>
      ) : null}
    </div>
  );
}

function useMountEffect(effect: () => void | (() => void)): void {
  /* eslint-disable no-restricted-syntax */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(effect, []);
  /* eslint-enable no-restricted-syntax */
}

/**
 * A patch the renderer cannot draw says so rather than taking the window down
 * with it: a diff is third-party output over host data, and one unexpected patch
 * must not unmount the chat beside it. A new patch gets a fresh boundary.
 */
class DiffBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render(): ReactNode {
    if (this.state.failed) {
      return <p className="workbench-diff-failed">This diff could not be drawn.</p>;
    }

    return this.props.children;
  }
}
