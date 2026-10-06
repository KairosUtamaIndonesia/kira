import { Button } from '@astryxdesign/core/Button';
import { Text } from '@astryxdesign/core/Text';
import { colorVars, spacingVars } from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { stopImpersonating } from './api/users';

const styles = stylex.create({
  bar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingVars['--spacing-3'],
    padding: spacingVars['--spacing-3'],
    backgroundColor: colorVars['--color-background-surface'],
    borderBottomColor: colorVars['--color-border'],
    borderBottomStyle: 'solid',
    borderBottomWidth: 1,
  },
});

/**
 * The marker an impersonated session cannot hide, and the way out of it.
 *
 * Drawn above whatever the acting person sees, so an administrator can never
 * mistake somebody else's screen for their own, and one click returns them to
 * themselves (docs/adr/0007).
 */
export default function ImpersonationBar({ name }: { name: string }) {
  return (
    <div role="status" {...stylex.props(styles.bar)}>
      <Text weight="semibold">You are acting as {name}.</Text>
      <Button
        label="Stop impersonating"
        variant="secondary"
        onClick={() => {
          void stopImpersonating().then(() => window.location.reload());
        }}
      />
    </div>
  );
}
