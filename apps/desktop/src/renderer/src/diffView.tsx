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
import { preloadHighlighter } from '@pierre/diffs';
import { PatchDiff } from '@pierre/diffs/react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { languageOf } from './filePreview';

/** Whether the pane draws its diff inline or in two columns. */
export type DiffStyle = 'unified' | 'split';

const DARK = '(prefers-color-scheme: dark)';

function schemeNow(): 'light' | 'dark' {
  return window.matchMedia(DARK).matches ? 'dark' : 'light';
}

function watchScheme(changed: () => void): () => void {
  const media = window.matchMedia(DARK);
  media.addEventListener('change', changed);

  return () => media.removeEventListener('change', changed);
}

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
  const scheme = useSyncExternalStore(watchScheme, schemeNow);
  const [loaded, setLoaded] = useState<string | null>(null);
  const theme = scheme === 'dark' ? 'github-dark' : 'github-light';
  const language = languageOf(path) ?? 'text';
  const key = `${theme}:${language}`;

  useEffect(() => {
    let live = true;
    void preloadHighlighter({ themes: [theme], langs: [language] })
      .catch(() => undefined)
      .then(() => {
        if (live) setLoaded(key);
      });

    return () => {
      live = false;
    };
  }, [key, theme, language]);

  return (
    <div className="workbench-diff" data-scheme={scheme}>
      {loaded === key ? (
        <PatchDiff
          patch={patch}
          disableWorkerPool
          options={{
            theme,
            diffStyle,
            overflow: wrap ? 'wrap' : 'scroll',
            disableFileHeader: true,
          }}
        />
      ) : null}
    </div>
  );
}
