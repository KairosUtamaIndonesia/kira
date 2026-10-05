/** PROTOTYPE — the few atoms the variants agree on: a file's name, its counts, its letter. */
import { Text } from '@astryxdesign/core/Text';
import {
  colorVars,
  spacingVars,
  textSizeVars,
  typographyVars,
} from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { DiffPatch } from '../diffView';
import { FileTypeIcon } from '../fileTypeIcon';
import { pathParts } from '../memoryGroups';
import { countsOf, type FileStatus, type FixtureFile } from './fixture';

const styles = stylex.create({
  name: { flexShrink: 0.01, minWidth: '4ch' },
  folder: { flexShrink: 100, minWidth: 0 },
  mono: {
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-sm'],
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
  added: { color: colorVars['--color-text-green'] },
  removed: { color: colorVars['--color-text-red'] },
  secondary: { color: colorVars['--color-text-secondary'] },
  counts: { display: 'inline-flex', gap: spacingVars['--spacing-1'] },
});

/** The letter git would write, with a U for a file it does not track yet. */
const LETTER: Record<FileStatus, string> = { M: 'M', A: 'A', D: 'D', '?': 'U' };

export function FileLabel({ path, muted = false }: { path: string; muted?: boolean }) {
  const { name, folder } = pathParts(path);

  return (
    <>
      <FileTypeIcon name={name} kind="file" />
      <span {...stylex.props(styles.name)}>
        <Text type="label" color={muted ? 'secondary' : 'primary'} maxLines={1}>
          {name}
        </Text>
      </span>
      {folder !== '' && (
        <span {...stylex.props(styles.folder)}>
          <Text type="supporting" color="secondary" maxLines={1}>
            {folder}
          </Text>
        </span>
      )}
    </>
  );
}

export function Counts({ item }: { item: FixtureFile }) {
  const { added, removed } = countsOf(item);

  return (
    <span {...stylex.props(styles.mono, styles.counts)}>
      {added > 0 && <span {...stylex.props(styles.added)}>+{added}</span>}
      {removed > 0 && <span {...stylex.props(styles.removed)}>−{removed}</span>}
    </span>
  );
}

export function Letter({ status }: { status: FileStatus }) {
  return (
    <span
      {...stylex.props(
        styles.mono,
        status === 'A' ? styles.added : status === 'D' ? styles.removed : styles.secondary,
      )}
    >
      {LETTER[status]}
    </span>
  );
}

/** A patch as the real view draws it, always inline. */
export function Patch({ patch, path }: { patch: string; path: string }) {
  return <DiffPatch patch={patch} path={path} diffStyle="unified" wrap={false} />;
}

/** Zero-padded and mono, as Work draws a lane's count. */
export function Count({ n }: { n: number }) {
  return <span {...stylex.props(styles.mono, styles.secondary)}>{String(n).padStart(2, '0')}</span>;
}
