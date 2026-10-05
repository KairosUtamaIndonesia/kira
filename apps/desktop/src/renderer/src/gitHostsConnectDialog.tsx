/**
 * PROTOTYPE — Connect a host, as a two-step dialog. Wipe me with the variants (or fold me in
 * as the real thing when one wins).
 *
 * Connecting ends in the one moment that cannot be repeated: the webhook secret, shown once. So
 * the dialog's second step is that moment, and it cannot be left until the secret is copied.
 */
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Dialog } from '@astryxdesign/core/Dialog';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import {
  borderVars,
  colorVars,
  spacingVars,
  textSizeVars,
  typographyVars,
} from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import { FlushDialogHeader } from './dialogHeader';
import { CopyButton } from './gitHostsParts';
import { PROVIDERS, addressOf, canConnect, needsAddress, type HostsModel } from './gitHostsModel';

export function ConnectDialog({ model, onClose }: { model: HostsModel; onClose: () => void }) {
  const { secret } = model;
  const [provider, setProvider] = useState('github');
  const [instanceUrl, setInstanceUrl] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [accountLogin, setAccountLogin] = useState('');
  const [copied, setCopied] = useState(false);
  const input = { provider, instanceUrl, accessToken, accountLogin };
  const ready = canConnect(input) && !model.busy;
  const chosen = PROVIDERS.find((each) => each.value === provider);
  const made =
    secret === null ? undefined : model.connections?.find((each) => each.id === secret.id);

  const finish = (): void => {
    model.dismissSecret();
    onClose();
  };
  // Until the secret is copied there is no way out: it cannot be shown again.
  const leave = (): void => {
    if (model.busy) return;
    if (secret === null) onClose();
    else if (copied) finish();
  };

  async function connect(): Promise<void> {
    if (!ready) return;
    if (await model.connect(input)) setAccessToken('');
  }

  return (
    <Dialog isOpen onOpenChange={(next) => !next && leave()} purpose="form" width={560}>
      {secret === null ? (
        <>
          <FlushDialogHeader
            title="Connect a host"
            subtitle="Step 1 of 2 · Choose the host and give Kira a token"
            onOpenChange={(next) => !next && leave()}
          />
          <div {...stylex.props(ui.body)}>
            <SegmentedControl
              label="Host"
              value={provider}
              onChange={setProvider}
              size="sm"
              layout="fill"
              isDisabled={model.busy}
            >
              {PROVIDERS.map((each) => (
                <SegmentedControlItem key={each.value} value={each.value} label={each.label} />
              ))}
            </SegmentedControl>
            <div {...stylex.props(ui.pair)}>
              <TextInput
                label="Address"
                value={instanceUrl}
                placeholder={needsAddress(provider) ? chosen?.example : 'Blank for github.com'}
                isOptional={!needsAddress(provider)}
                isRequired={needsAddress(provider)}
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
            <Text type="supporting" color="secondary" maxLines={2}>
              Next, Kira shows the webhook secret to add on the host. It is shown once.
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
      ) : (
        <>
          <FlushDialogHeader
            title="Add the webhook"
            subtitle={`Step 2 of 2 · ${made === undefined ? 'The host is connected' : `${made.accountLogin} on ${addressOf(made)} is connected`}`}
            onOpenChange={(next) => !next && leave()}
          />
          <div {...stylex.props(ui.body)}>
            <Text type="supporting" color="secondary">
              In the host’s webhook settings, point a webhook at the URL below and give it this
              secret.
            </Text>
            <div {...stylex.props(ui.ledger)}>
              <div {...stylex.props(ui.secretRow)}>
                <span {...stylex.props(ui.secretName)}>Payload URL</span>
                <span {...stylex.props(ui.mono)}>{`/api/webhooks/git/${secret.id}`}</span>
                <CopyButton value={`/api/webhooks/git/${secret.id}`} label="Payload URL" />
              </div>
              <div {...stylex.props(ui.secretRow)}>
                <span {...stylex.props(ui.secretName)}>Secret</span>
                <span {...stylex.props(ui.mono)}>{secret.value}</span>
                <CopyButton
                  value={secret.value}
                  label="Webhook secret"
                  onCopied={() => setCopied(true)}
                />
              </div>
            </div>
            <Banner
              status="warning"
              title="This secret is shown once"
              description="Kira keeps it sealed and cannot show it again. If it is lost, disconnect the host and connect it again."
            />
          </div>
          <div {...stylex.props(ui.foot)}>
            <Text type="supporting" color="secondary">
              {copied ? 'Secret copied.' : 'Copy the secret to continue.'}
            </Text>
            <span {...stylex.props(ui.footButtons)}>
              <Button
                label="Done"
                size="sm"
                variant="primary"
                isDisabled={!copied}
                onClick={finish}
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
  pair: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
    gap: spacingVars['--spacing-3'],
    alignItems: 'start',
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
  ledger: { display: 'flex', flexDirection: 'column' },
  secretRow: {
    display: 'grid',
    gridTemplateColumns: '96px minmax(0, 1fr) auto',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    minHeight: 44,
    borderBlockEndWidth: borderVars['--border-width'],
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-border'],
  },
  secretName: {
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
  },
  mono: {
    minWidth: 0,
    overflowWrap: 'anywhere',
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-sm'],
  },
});
