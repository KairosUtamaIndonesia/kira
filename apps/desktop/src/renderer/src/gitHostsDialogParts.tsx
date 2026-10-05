/**
 * PROTOTYPE — what the Connect a host dialog variants share: the draft they fill in, the rule
 * about leaving with a webhook secret that was never copied, and the rows that show the secret.
 * Wipe me with the losing variants (or fold me in with the winner).
 */
import { Button } from '@astryxdesign/core/Button';
import { Text } from '@astryxdesign/core/Text';
import {
  borderVars,
  colorVars,
  spacingVars,
  textSizeVars,
  typographyVars,
} from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import { CopyButton } from './gitHostsParts';
import { PROVIDERS, canConnect, type HostsModel, type Provider } from './gitHostsModel';

export interface DialogProps {
  model: HostsModel;
  onClose: () => void;
}

export const PROVIDER_NOTES: Record<string, string> = {
  github: 'github.com or GitHub Enterprise',
  gitlab: 'gitlab.com or a self-managed server',
  forgejo: 'Your own server',
  gitea: 'Your own server',
};

export function useDraft(model: HostsModel) {
  const [provider, setProvider] = useState('github');
  const [instanceUrl, setInstanceUrl] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [accountLogin, setAccountLogin] = useState('');
  const input = { provider, instanceUrl, accessToken, accountLogin };
  const ready = canConnect(input) && !model.busy;
  const chosen: Provider = PROVIDERS.find((each) => each.value === provider) ?? PROVIDERS[0]!;

  async function connect(): Promise<void> {
    if (!ready) return;
    if (await model.connect(input)) setAccessToken('');
  }

  return {
    provider,
    setProvider,
    instanceUrl,
    setInstanceUrl,
    accessToken,
    setAccessToken,
    accountLogin,
    setAccountLogin,
    ready,
    chosen,
    connect,
  };
}

/**
 * Leaving once a webhook secret is on screen loses it for good, so the first try only warns and
 * a second one goes through. Having copied it makes leaving free.
 */
export function useSecretGuard({ model, onClose }: DialogProps) {
  const [copied, setCopied] = useState(false);
  const [warned, setWarned] = useState(false);
  const lost = warned && !copied;

  const finish = (): void => {
    model.dismissSecret();
    onClose();
  };
  const leave = (): void => {
    if (model.busy) return;
    if (model.secret === null) onClose();
    else if (copied || warned) finish();
    else setWarned(true);
  };

  return { copied, markCopied: () => setCopied(true), lost, leave, finish };
}

export function SecretFoot({ guard }: { guard: ReturnType<typeof useSecretGuard> }) {
  return (
    <div {...stylex.props(ui.foot)}>
      <Text type="supporting" color={guard.lost ? 'primary' : 'secondary'}>
        {guard.copied
          ? 'Secret copied.'
          : guard.lost
            ? 'Not copied yet. Close again to lose the secret.'
            : 'Copy the secret before you close this.'}
      </Text>
      <span {...stylex.props(ui.footButtons)}>
        <Button
          label={guard.lost ? 'Close without copying' : 'Done'}
          size="sm"
          variant={guard.lost ? 'destructive' : 'primary'}
          onClick={guard.leave}
        />
      </span>
    </div>
  );
}

/** The payload URL and the secret, as two ruled rows with a copy control each. */
export function SecretRows({
  secret,
  onCopiedSecret,
}: {
  secret: { id: string; value: string };
  onCopiedSecret: () => void;
}) {
  const path = `/api/webhooks/git/${secret.id}`;
  return (
    <div {...stylex.props(ui.rows)}>
      <div {...stylex.props(ui.row)}>
        <span {...stylex.props(ui.name)}>Payload URL</span>
        <span {...stylex.props(ui.mono)}>{path}</span>
        <CopyButton value={path} label="Payload URL" />
      </div>
      <div {...stylex.props(ui.row)}>
        <span {...stylex.props(ui.name)}>Secret</span>
        <span {...stylex.props(ui.mono)}>{secret.value}</span>
        <CopyButton value={secret.value} label="Webhook secret" onCopied={onCopiedSecret} />
      </div>
    </div>
  );
}

export const ui = stylex.create({
  foot: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacingVars['--spacing-3'],
    paddingBlockStart: spacingVars['--spacing-4'],
  },
  footButtons: { display: 'flex', gap: spacingVars['--spacing-2'], marginInlineStart: 'auto' },
  rows: { display: 'flex', flexDirection: 'column' },
  row: {
    display: 'grid',
    gridTemplateColumns: '96px minmax(0, 1fr) auto',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    minHeight: 44,
    borderBlockEndWidth: borderVars['--border-width'],
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-border'],
  },
  name: { fontSize: textSizeVars['--font-size-sm'], color: colorVars['--color-text-secondary'] },
  mono: {
    minWidth: 0,
    overflowWrap: 'anywhere',
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-sm'],
  },
});
