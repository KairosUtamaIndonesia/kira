/**
 * PROTOTYPE — Connect a host, dialog B: tabs, then a receipt.
 *
 * One screen to fill: the four hosts are tabs, and the body is only what that host takes, with
 * the GitHub App offered first on GitHub's. Connecting swaps the body for a receipt — the
 * payload URL and secret as one block with a single control that copies both.
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
import { FlushDialogHeader } from './dialogHeader';
import {
  SecretFoot,
  ui as shared,
  useDraft,
  useSecretGuard,
  type DialogProps,
} from './gitHostsDialogParts';
import { PROVIDERS, addressOf, needsAddress } from './gitHostsModel';

export function DialogB(props: DialogProps) {
  const { model, onClose } = props;
  const { secret, github } = model;
  const draft = useDraft(model);
  const guard = useSecretGuard(props);
  const app = github?.configured === true && github.url !== null ? github.url : null;
  const made =
    secret === null ? undefined : model.connections?.find((each) => each.id === secret.id);
  const address = needsAddress(draft.provider);
  const both = secret === null ? '' : `/api/webhooks/git/${secret.id}\n${secret.value}`;
  const { copy, isCopied } = useClipboard({ announce: 'Payload URL and secret copied' });

  const close = (next: boolean): void => {
    if (!next) guard.leave();
  };

  return (
    <Dialog isOpen onOpenChange={close} purpose="form" width={520}>
      {secret !== null ? (
        <>
          <FlushDialogHeader
            title="Connected"
            subtitle={
              made === undefined
                ? 'The host is connected'
                : `${made.accountLogin} on ${addressOf(made)}`
            }
            onOpenChange={close}
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
                  void copy(both).then((ok) => {
                    if (ok) guard.markCopied();
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
          <SecretFoot guard={guard} />
        </>
      ) : (
        <>
          <FlushDialogHeader title="Connect a host" onOpenChange={close} />
          <TabList
            value={draft.provider}
            onChange={draft.setProvider}
            size="sm"
            hasDivider
            isFullBleed
          >
            {PROVIDERS.map((each) => (
              <Tab key={each.value} value={each.value} label={each.label} />
            ))}
          </TabList>
          <div {...stylex.props(ui.body, ui.bodyTop)}>
            {draft.provider === 'github' && app !== null && (
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
            )}
            {draft.provider === 'github' && app !== null && (
              <Text type="supporting" color="secondary">
                Or connect with a personal access token:
              </Text>
            )}
            <div {...stylex.props(ui.pair)}>
              <TextInput
                label={draft.provider === 'github' ? 'Enterprise address' : 'Server address'}
                value={draft.instanceUrl}
                placeholder={address ? draft.chosen.example : 'Blank for github.com'}
                isOptional={!address}
                isRequired={address}
                size="sm"
                onChange={draft.setInstanceUrl}
              />
              <TextInput
                label="Account"
                value={draft.accountLogin}
                placeholder="acme"
                isOptional
                size="sm"
                onChange={draft.setAccountLogin}
              />
            </div>
            <TextInput
              label="Access token"
              type="password"
              value={draft.accessToken}
              isRequired
              size="sm"
              onChange={draft.setAccessToken}
              onEnter={() => void draft.connect()}
            />
            {model.trouble !== null && (
              <Banner status="error" title="Could not connect" description={model.trouble} />
            )}
          </div>
          <div {...stylex.props(shared.foot)}>
            <Text type="supporting" color="secondary" maxLines={2}>
              Needs an administrator.
            </Text>
            <span {...stylex.props(shared.footButtons)}>
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
                isDisabled={!draft.ready}
                onClick={() => void draft.connect()}
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
});
