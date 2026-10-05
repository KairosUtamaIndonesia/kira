/**
 * PROTOTYPE — Connect a host, dialog A: choose, then fill.
 *
 * Three screens in one dialog, each asking one thing. First a ruled list of where the host
 * lives (with the GitHub App as a row of its own, since it needs no token); then only the
 * fields that host takes, with a way back; then the webhook secret.
 */
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Dialog } from '@astryxdesign/core/Dialog';
import { Icon } from '@astryxdesign/core/Icon';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import {
  borderVars,
  colorVars,
  focusVars,
  spacingVars,
  textSizeVars,
} from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronRight, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { FlushDialogHeader } from './dialogHeader';
import {
  PROVIDER_NOTES,
  SecretFoot,
  SecretRows,
  ui as shared,
  useDraft,
  useSecretGuard,
  type DialogProps,
} from './gitHostsDialogParts';
import { PROVIDERS, addressOf, needsAddress } from './gitHostsModel';

export function DialogA(props: DialogProps) {
  const { model, onClose } = props;
  const { secret, github } = model;
  const draft = useDraft(model);
  const guard = useSecretGuard(props);
  const [choosing, setChoosing] = useState(true);
  const app = github?.configured === true && github.url !== null ? github.url : null;
  const made =
    secret === null ? undefined : model.connections?.find((each) => each.id === secret.id);
  const address = needsAddress(draft.provider);

  const close = (next: boolean): void => {
    if (!next) guard.leave();
  };

  return (
    <Dialog isOpen onOpenChange={close} purpose="form" width={520}>
      {secret !== null ? (
        <>
          <FlushDialogHeader
            title="Add the webhook"
            subtitle={
              made === undefined
                ? 'The host is connected'
                : `${made.accountLogin} on ${addressOf(made)} is connected`
            }
            onOpenChange={close}
          />
          <div {...stylex.props(ui.body)}>
            <Text type="supporting" color="secondary">
              In the host’s webhook settings, point a webhook at the URL below and give it this
              secret.
            </Text>
            <SecretRows secret={secret} onCopiedSecret={guard.markCopied} />
            <Banner
              status="warning"
              title="This secret is shown once"
              description="Kira keeps it sealed and cannot show it again. If it is lost, disconnect the host and connect it again."
            />
          </div>
          <SecretFoot guard={guard} />
        </>
      ) : choosing ? (
        <>
          <FlushDialogHeader
            title="Connect a host"
            subtitle="Where does it live?"
            onOpenChange={close}
          />
          <div {...stylex.props(ui.list)}>
            {app !== null && (
              <button
                type="button"
                onClick={() => window.open(app, '_blank', 'noopener')}
                {...stylex.props(ui.choice)}
              >
                <span {...stylex.props(ui.choiceText)}>
                  <Text type="label" weight="medium">
                    GitHub App
                  </Text>
                  <span {...stylex.props(ui.note)}>
                    Watches GitHub without a personal token. Opens GitHub to install.
                  </span>
                </span>
                <Icon icon={ExternalLink} size="sm" color="secondary" />
              </button>
            )}
            {PROVIDERS.map((each) => (
              <button
                key={each.value}
                type="button"
                onClick={() => {
                  draft.setProvider(each.value);
                  setChoosing(false);
                }}
                {...stylex.props(ui.choice)}
              >
                <span {...stylex.props(ui.choiceText)}>
                  <Text type="label" weight="medium">
                    {each.label}
                  </Text>
                  <span {...stylex.props(ui.note)}>
                    {PROVIDER_NOTES[each.value]}
                    {each.value === 'github' && app !== null ? ', with a personal token' : ''}
                  </span>
                </span>
                <Icon icon={ChevronRight} size="sm" color="secondary" />
              </button>
            ))}
          </div>
          <div {...stylex.props(shared.foot)}>
            <span {...stylex.props(shared.footButtons)}>
              <Button label="Cancel" size="sm" variant="ghost" onClick={onClose} />
            </span>
          </div>
        </>
      ) : (
        <>
          <FlushDialogHeader
            title={`Connect ${draft.chosen.label}`}
            subtitle="A personal access token. Connecting needs an administrator."
            onOpenChange={close}
          />
          <div {...stylex.props(ui.body)}>
            <TextInput
              label={draft.provider === 'github' ? 'GitHub Enterprise address' : 'Server address'}
              value={draft.instanceUrl}
              placeholder={address ? draft.chosen.example : 'Blank for github.com'}
              isOptional={!address}
              isRequired={address}
              size="sm"
              onChange={draft.setInstanceUrl}
            />
            <TextInput
              label="Access token"
              type="password"
              value={draft.accessToken}
              isRequired
              size="sm"
              onChange={draft.setAccessToken}
              onEnter={() => void draft.connect()}
            />
            <TextInput
              label="Account"
              value={draft.accountLogin}
              placeholder="acme"
              isOptional
              size="sm"
              onChange={draft.setAccountLogin}
            />
            {model.trouble !== null && (
              <Banner status="error" title="Could not connect" description={model.trouble} />
            )}
          </div>
          <div {...stylex.props(shared.foot)}>
            <Button
              label="Back"
              size="sm"
              variant="ghost"
              isDisabled={model.busy}
              onClick={() => setChoosing(true)}
            />
            <span {...stylex.props(shared.footButtons)}>
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
  list: {
    display: 'flex',
    flexDirection: 'column',
    borderBlockStartWidth: borderVars['--border-width'],
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: colorVars['--color-border'],
  },
  choice: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-3'],
    minHeight: 56,
    paddingInline: 0,
    paddingBlock: spacingVars['--spacing-2'],
    border: 0,
    borderBlockEndWidth: borderVars['--border-width'],
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-border'],
    background: { default: 'transparent', ':hover': colorVars['--color-overlay-hover'] },
    color: colorVars['--color-text-primary'],
    font: 'inherit',
    textAlign: 'start',
    cursor: 'pointer',
    outlineStyle: { default: 'none', ':focus-visible': focusVars['--focus-outline-style'] },
    outlineWidth: focusVars['--focus-outline-width'],
    outlineColor: focusVars['--focus-outline-color'],
    outlineOffset: -2,
  },
  choiceText: { display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 },
  note: { fontSize: textSizeVars['--font-size-sm'], color: colorVars['--color-text-secondary'] },
});
