/**
 * Astryx's `DialogHeader` pads itself inside the dialog's own padding, so its title sits one
 * padding step further in than the content below it. Pulling it out by that step puts the
 * title, and the close button at its far end, on the same edges as the body and the foot.
 */
import { DialogHeader } from '@astryxdesign/core/Dialog';
import { spacingVars } from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import type { ComponentProps } from 'react';

const styles = stylex.create({
  flush: { marginInline: `calc(-1 * ${spacingVars['--spacing-4']})` },
});

export function FlushDialogHeader(props: ComponentProps<typeof DialogHeader>) {
  return <DialogHeader {...props} xstyle={styles.flush} />;
}
