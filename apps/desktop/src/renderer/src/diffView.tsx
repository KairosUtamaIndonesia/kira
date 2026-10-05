/**
 * One patch, drawn with the diff library on Kira's existing shiki.
 *
 * The library renders into a shadow root, so Kira's theme cannot reach inside
 * with StyleX. It crosses the boundary the way a custom property does: the host
 * element names the code font and the surface colours in `styles.css`, and the
 * shadow root reads them. Nothing here introduces a second highlighter — the
 * library is built on the shiki the file viewer already uses.
 */
import { PatchDiff } from '@pierre/diffs/react';
import { useSyncExternalStore } from 'react';

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
 * `patch` is one file's unified diff. `wrap` breaks long lines rather than
 * scrolling them sideways, which is what reading a wide file wants.
 */
export function DiffPatch({
  patch,
  diffStyle,
  wrap,
}: {
  patch: string;
  diffStyle: DiffStyle;
  wrap: boolean;
}) {
  const scheme = useSyncExternalStore(watchScheme, schemeNow);

  return (
    <div className="workbench-diff" data-scheme={scheme}>
      <PatchDiff
        patch={patch}
        disableWorkerPool
        options={{
          theme: scheme === 'dark' ? 'github-dark' : 'github-light',
          diffStyle,
          overflow: wrap ? 'wrap' : 'scroll',
          disableFileHeader: true,
        }}
      />
    </div>
  );
}
