/**
 * Connecting a Git host, in a dialog over the Git hosts page.
 *
 * The four hosts are tabs, and the body asks only what that host takes; GitHub's tab offers the
 * GitHub App first, since it needs no token. Connecting ends in the one thing that cannot be
 * repeated: a token connection's webhook secret, which the server shows once. So the dialog
 * then swaps to a receipt with the payload URL and secret and a single control that copies
 * both, and leaving it before they are copied takes two tries (docs/adr/0026).
 */
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Dialog } from '@astryxdesign/core/Dialog';
import { Icon } from '@astryxdesign/core/Icon';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useClipboard } from '@astryxdesign/core/hooks';
import {
  colorVars,
  radiusVars,
  spacingVars,
  textSizeVars,
  typographyVars,
} from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { FlushDialogHeader } from './dialogHeader';
import { HOST_MARKS } from './gitHostIcons';
import { PROVIDERS, addressOf, canConnect, needsAddress, type HostsModel } from './gitHostsModel';

export function ConnectDialog({ model, onClose }: { model: HostsModel; onClose: () => void }) {
  const { secret, github } = model;
  const [provider, setProvider] = useState('github');
  const [instanceUrl, setInstanceUrl] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [accountLogin, setAccountLogin] = useState('');
  const [copied, setCopied] = useState(false);
  const [warned, setWarned] = useState(false);
  const { copy, isCopied } = useClipboard({ announce: 'Payload URL and secret copied' });

  const input = { provider, instanceUrl, accessToken, accountLogin };
  const ready = canConnect(input) && !model.busy;
  const chosen = PROVIDERS.find((each) => each.value === provider) ?? PROVIDERS[0];
  const address = needsAddress(provider);
  const app = github?.configured === true && github.url !== null ? github.url : null;
  const made =
    secret === null ? undefined : model.connections?.find((each) => each.id === secret.id);
  const unsaved = warned && !copied;

  async function connect(): Promise<void> {
    if (!ready) return;
    if (await model.connect(input)) setAccessToken('');
  }

  function finish(): void {
    model.dismissSecret();
    onClose();
  }

  // Leaving a secret that was never copied loses it for good, so the first try only warns.
  function leave(): void {
    if (model.busy) return;
    if (secret === null) onClose();
    else if (copied || warned) finish();
    else setWarned(true);
  }

  return (
    <Dialog isOpen onOpenChange={(open) => !open && leave()} purpose="form" width={520}>
      {secret !== null ? (
        <>
          <FlushDialogHeader
            title="Connected"
            subtitle={
              made === undefined
                ? 'The host is connected'
                : `${made.accountLogin} on ${addressOf(made)}`
            }
            onOpenChange={(open) => !open && leave()}
          />
          <div {...stylex.props(ui.body)}>
            <Text type="supporting" color="secondary">
              Add a webhook on the host with this URL, and this secret as its secret.
            </Text>
            <div {...stylex.props(ui.receipt)}>
              <span {...stylex.props(ui.label)}>Payload URL</span>
              <span {...stylex.props(ui.value)}>{`/api/webhooks/git/${secret.id}`}</span>
              <span {...stylex.props(ui.label)}>Secret</span>
              <span {...stylex.props(ui.value)}>{secret.value}</span>
            </div>
            <div>
              <Button
                label={isCopied ? 'Copied' : 'Copy both'}
                size="sm"
                variant="secondary"
                icon={<Icon icon={isCopied ? Check : Copy} size="sm" />}
                onClick={() => {
                  void copy(`/api/webhooks/git/${secret.id}\n${secret.value}`).then((ok) => {
                    if (ok) setCopied(true);
                  });
                }}
              />
            </div>
            <Banner
              status="warning"
              title="The secret is shown once"
              description="Kira keeps it sealed and cannot show it again. If it is lost, disconnect the host and connect it again."
            />
          </div>
          <div {...stylex.props(ui.foot)}>
            <Text type="supporting" color={unsaved ? 'primary' : 'secondary'}>
              {copied
                ? 'Copied.'
                : unsaved
                  ? 'Not copied yet. Close again to lose the secret.'
                  : 'Copy the secret before you close this.'}
            </Text>
            <span {...stylex.props(ui.footButtons)}>
              <Button
                label={unsaved ? 'Close without copying' : 'Done'}
                size="sm"
                variant={unsaved ? 'destructive' : 'primary'}
                onClick={leave}
              />
            </span>
          </div>
        </>
      ) : (
        <>
          <FlushDialogHeader title="Connect a host" onOpenChange={(open) => !open && leave()} />
          <TabList value={provider} onChange={setProvider} size="sm" hasDivider isFullBleed>
            {PROVIDERS.map((each) => (
              <Tab
                key={each.value}
                value={each.value}
                label={each.label}
                icon={<Icon icon={HOST_MARKS[each.value] ?? ExternalLink} size="sm" />}
              />
            ))}
          </TabList>
          <div {...stylex.props(ui.body, ui.bodyTop)}>
            {provider === 'github' && app !== null && (
              <>
                <div {...stylex.props(ui.app)}>
                  <span {...stylex.props(ui.appText)}>
                    <Text type="label" weight="medium">
                      Install the GitHub App
                    </Text>
                    <Text type="supporting" color="secondary">
                      Watches GitHub without a personal token.
                    </Text>
                  </span>
                  <Button
                    label="Install"
                    size="sm"
                    variant="secondary"
                    endContent={<Icon icon={ExternalLink} size="sm" />}
                    onClick={() => window.open(app, '_blank', 'noopener')}
                  />
                </div>
                <Text type="supporting" color="secondary">
                  Or connect with a personal access token:
                </Text>
              </>
            )}
            <div {...stylex.props(ui.pair)}>
              <TextInput
                label={provider === 'github' ? 'Enterprise address' : 'Server address'}
                value={instanceUrl}
                placeholder={address ? chosen?.example : 'Blank for github.com'}
                isOptional={!address}
                isRequired={address}
                size="sm"
                onChange={setInstanceUrl}
              />
              <TextInput
                label="Account"
                value={accountLogin}
                placeholder="acme"
                isOptional
                size="sm"
                onChange={setAccountLogin}
              />
            </div>
            <TextInput
              label="Access token"
              type="password"
              value={accessToken}
              isRequired
              size="sm"
              onChange={setAccessToken}
              onEnter={() => void connect()}
            />
            {model.trouble !== null && (
              <Banner status="error" title="Could not connect" description={model.trouble} />
            )}
          </div>
          <div {...stylex.props(ui.foot)}>
            <Text type="supporting" color="secondary">
              Needs an administrator.
            </Text>
            <span {...stylex.props(ui.footButtons)}>
              <Button
                label="Cancel"
                size="sm"
                variant="ghost"
                isDisabled={model.busy}
                onClick={onClose}
              />
              <Button
                label={model.busy ? 'Connecting' : 'Connect host'}
                size="sm"
                variant="primary"
                isDisabled={!ready}
                onClick={() => void connect()}
              />
            </span>
          </div>
        </>
      )}
    </Dialog>
  );
}

const ui = stylex.create({
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-3'],
    paddingBlock: spacingVars['--spacing-2'],
  },
  bodyTop: { paddingBlockStart: spacingVars['--spacing-4'] },
  pair: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
    gap: spacingVars['--spacing-3'],
    alignItems: 'start',
  },
  app: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingVars['--spacing-4'],
    padding: spacingVars['--spacing-3'],
    borderRadius: radiusVars['--radius-container'],
    backgroundColor: colorVars['--color-background-muted'],
  },
  appText: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
  receipt: {
    display: 'grid',
    gridTemplateColumns: '88px minmax(0, 1fr)',
    rowGap: spacingVars['--spacing-2'],
    columnGap: spacingVars['--spacing-3'],
    padding: spacingVars['--spacing-3'],
    borderRadius: radiusVars['--radius-container'],
    backgroundColor: colorVars['--color-background-muted'],
  },
  label: { fontSize: textSizeVars['--font-size-sm'], color: colorVars['--color-text-secondary'] },
  value: {
    minWidth: 0,
    overflowWrap: 'anywhere',
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-sm'],
  },
  foot: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacingVars['--spacing-3'],
    paddingBlockStart: spacingVars['--spacing-4'],
  },
  footButtons: { display: 'flex', gap: spacingVars['--spacing-2'], marginInlineStart: 'auto' },
});
