/**
 * PROTOTYPE — Connect a host, dialog C: the whole journey in one frame.
 *
 * Three ruled rows — Host, Credentials, Webhook — of which one is open at a time. A finished
 * row folds to a line saying what was chosen, and the Webhook row is there from the start,
 * dim, so nobody is surprised that connecting ends in a secret that is shown once.
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
  spacingVars,
  textSizeVars,
  typographyVars,
} from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { ExternalLink } from 'lucide-react';
import { useState, type ReactNode } from 'react';
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

export function DialogC(props: DialogProps) {
  const { model, onClose } = props;
  const { secret, github } = model;
  const draft = useDraft(model);
  const guard = useSecretGuard(props);
  const [step, setStep] = useState<'host' | 'details'>('host');
  const app = github?.configured === true && github.url !== null ? github.url : null;
  const made =
    secret === null ? undefined : model.connections?.find((each) => each.id === secret.id);
  const address = needsAddress(draft.provider);
  const connected = secret !== null;

  const close = (next: boolean): void => {
    if (!next) guard.leave();
  };

  return (
    <Dialog isOpen onOpenChange={close} purpose="form" width={560}>
      <FlushDialogHeader
        title="Connect a host"
        subtitle="Pick the host, give Kira a token, then add the webhook it shows you."
        onOpenChange={close}
      />
      <div {...stylex.props(ui.rows)}>
        <Row
          index="1"
          title="Host"
          open={step === 'host' && !connected}
          summary={
            step === 'details' || connected
              ? `${draft.chosen.label} · ${PROVIDER_NOTES[draft.provider]}`
              : null
          }
          action={
            step === 'details' && !connected ? (
              <Button
                label="Change"
                size="sm"
                variant="ghost"
                isDisabled={model.busy}
                onClick={() => setStep('host')}
              />
            ) : null
          }
        >
          <div {...stylex.props(ui.picks)}>
            {PROVIDERS.map((each) => (
              <Button
                key={each.value}
                label={each.label}
                size="sm"
                variant={draft.provider === each.value ? 'secondary' : 'ghost'}
                onClick={() => {
                  draft.setProvider(each.value);
                  setStep('details');
                }}
              />
            ))}
          </div>
          {app !== null && (
            <div {...stylex.props(ui.app)}>
              <Text type="supporting" color="secondary">
                On GitHub, the App needs no token.
              </Text>
              <Button
                label="Install the GitHub App"
                size="sm"
                variant="ghost"
                endContent={<Icon icon={ExternalLink} size="sm" />}
                onClick={() => window.open(app, '_blank', 'noopener')}
              />
            </div>
          )}
        </Row>

        <Row
          index="2"
          title="Credentials"
          open={step === 'details' && !connected}
          dim={step === 'host' && !connected}
          summary={
            connected
              ? made === undefined
                ? 'Connected'
                : `${made.accountLogin} on ${addressOf(made)}`
              : null
          }
        >
          <TextInput
            label={draft.provider === 'github' ? 'Enterprise address' : 'Server address'}
            value={draft.instanceUrl}
            placeholder={address ? draft.chosen.example : 'Blank for github.com'}
            isOptional={!address}
            isRequired={address}
            size="sm"
            onChange={draft.setInstanceUrl}
          />
          <div {...stylex.props(ui.pair)}>
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
          </div>
          {model.trouble !== null && (
            <Banner status="error" title="Could not connect" description={model.trouble} />
          )}
          <div {...stylex.props(ui.go)}>
            <Button
              label={model.busy ? 'Connecting' : 'Connect host'}
              size="sm"
              variant="primary"
              isDisabled={!draft.ready}
              onClick={() => void draft.connect()}
            />
          </div>
        </Row>

        <Row
          index="3"
          title="Webhook"
          open={connected}
          dim={!connected}
          summary={connected ? null : 'Shown once, after you connect. Copy it before you close.'}
        >
          {secret !== null && <SecretRows secret={secret} onCopiedSecret={guard.markCopied} />}
        </Row>
      </div>
      {connected ? (
        <SecretFoot guard={guard} />
      ) : (
        <div {...stylex.props(shared.foot)}>
          <Text type="supporting" color="secondary">
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
          </span>
        </div>
      )}
    </Dialog>
  );
}

function Row({
  index,
  title,
  open,
  dim = false,
  summary,
  action,
  children,
}: {
  index: string;
  title: string;
  open: boolean;
  dim?: boolean;
  summary: string | null;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section {...stylex.props(ui.row, dim && ui.dim)}>
      <span {...stylex.props(ui.index)}>{index}</span>
      <div {...stylex.props(ui.rowBody)}>
        <div {...stylex.props(ui.rowHead)}>
          <Text type="label" weight="medium">
            {title}
          </Text>
          {!open && summary !== null && <span {...stylex.props(ui.summary)}>{summary}</span>}
          <span {...stylex.props(ui.spacer)} />
          {action}
        </div>
        {open && <div {...stylex.props(ui.rowContent)}>{children}</div>}
      </div>
    </section>
  );
}

const ui = stylex.create({
  rows: { display: 'flex', flexDirection: 'column', paddingBlockStart: spacingVars['--spacing-2'] },
  row: {
    display: 'grid',
    gridTemplateColumns: '24px minmax(0, 1fr)',
    columnGap: spacingVars['--spacing-2'],
    paddingBlock: spacingVars['--spacing-3'],
    borderBlockStartWidth: borderVars['--border-width'],
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: colorVars['--color-border'],
  },
  dim: { opacity: 0.6 },
  index: {
    paddingBlockStart: 2,
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
    fontVariantNumeric: 'tabular-nums',
  },
  rowBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-3'],
    minWidth: 0,
  },
  rowHead: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-3'],
    minHeight: 28,
    minWidth: 0,
  },
  summary: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
  },
  spacer: { flex: 1 },
  rowContent: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-3'] },
  picks: { display: 'flex', flexWrap: 'wrap', gap: spacingVars['--spacing-2'] },
  app: { display: 'flex', alignItems: 'center', gap: spacingVars['--spacing-2'], flexWrap: 'wrap' },
  pair: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
    gap: spacingVars['--spacing-3'],
    alignItems: 'start',
  },
  go: { display: 'flex', justifyContent: 'flex-end' },
});
