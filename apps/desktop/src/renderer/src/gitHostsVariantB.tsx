/**
 * PROTOTYPE — Git hosts, variant B: by provider.
 *
 * The page is split the way the decision is: first which kind of host, then what is connected
 * and what connecting it takes. A rail lists the four providers with how many accounts each
 * holds; the pane beside it asks only for what that provider needs — GitHub leads with its
 * App and keeps the token behind a disclosure, the others ask for their server's address.
 */
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { Icon } from '@astryxdesign/core/Icon';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import {
  borderVars,
  colorVars,
  focusVars,
  radiusVars,
  spacingVars,
  textSizeVars,
  typographyVars,
} from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import type { GitConnection } from '../../preload/bridge';
import {
  PROVIDERS,
  accessLabel,
  addressOf,
  canConnect,
  needsAddress,
  providerLabel,
  webhookPath,
  type HostsModel,
  type Provider,
} from './gitHostsModel';
import { CopyButton } from './gitHostsParts';
import { age } from './workRows';

export function VariantB({ model }: { model: HostsModel }) {
  const { connections, trouble, secret } = model;
  const [picked, setPicked] = useState<string | null>(null);
  const held = (value: string): GitConnection[] =>
    (connections ?? []).filter((each) => each.provider === value);
  // Nothing chosen yet: open on the first provider that holds something, so a populated page
  // does not start on an empty pane.
  const current: Provider =
    PROVIDERS.find((each) => each.value === picked) ??
    PROVIDERS.find((each) => held(each.value).length > 0) ??
    PROVIDERS[0]!;

  return (
    <div {...stylex.props(ui.page)}>
      <div {...stylex.props(ui.intro)}>
        <Heading level={2}>Git hosts</Heading>
        <Text color="secondary" size="sm">
          A repository is watched once it is attached to a project, and its host is connected here.
          Connecting needs an administrator and a personal access token.
        </Text>
      </div>

      {trouble !== null && <Banner status="error" title="Git hosts" description={trouble} />}

      <div {...stylex.props(ui.split)}>
        <nav aria-label="Providers" {...stylex.props(ui.rail)}>
          {PROVIDERS.map((each) => {
            const count = held(each.value).length;
            const on = each.value === current.value;
            return (
              <button
                key={each.value}
                type="button"
                aria-current={on ? 'true' : undefined}
                onClick={() => setPicked(each.value)}
                {...stylex.props(ui.railRow, on && ui.railOn)}
              >
                <span {...stylex.props(ui.dot, on && ui.dotOn)} aria-hidden />
                <span {...stylex.props(ui.railName)}>{each.label}</span>
                <span {...stylex.props(ui.railCount, count === 0 && ui.railNone)}>
                  {connections === null ? '' : count === 0 ? '—' : String(count).padStart(2, '0')}
                </span>
              </button>
            );
          })}
        </nav>

        <Pane
          key={current.value}
          provider={current}
          connections={held(current.value)}
          loading={connections === null}
          model={model}
          secret={secret}
        />
      </div>
    </div>
  );
}

function Pane({
  provider,
  connections,
  loading,
  model,
  secret,
}: {
  provider: Provider;
  connections: GitConnection[];
  loading: boolean;
  model: HostsModel;
  secret: HostsModel['secret'];
}) {
  const [leaving, setLeaving] = useState<GitConnection | null>(null);
  const app =
    provider.value === 'github' && model.github?.configured === true && model.github.url !== null;

  return (
    <section aria-label={provider.label} {...stylex.props(ui.pane)}>
      <header {...stylex.props(ui.paneHead)}>
        <Heading level={3}>{provider.label}</Heading>
        {provider.hosted !== null && (
          <span {...stylex.props(ui.mono, ui.dim)}>{provider.hosted}</span>
        )}
      </header>

      {secret !== null && (
        <output {...stylex.props(ui.secret)}>
          <Text type="label" weight="medium">
            Webhook secret — copy it now, it is shown once
          </Text>
          <div {...stylex.props(ui.secretLine)}>
            <span {...stylex.props(ui.mono, ui.clip)}>{secret.value}</span>
            <CopyButton value={secret.value} label="Webhook secret" />
          </div>
          <div {...stylex.props(ui.secretLine)}>
            <span
              {...stylex.props(ui.mono, ui.clip, ui.dim)}
            >{`/api/webhooks/git/${secret.id}`}</span>
            <CopyButton value={`/api/webhooks/git/${secret.id}`} label="Payload URL" />
          </div>
          <div>
            <Button label="Done" size="sm" variant="secondary" onClick={model.dismissSecret} />
          </div>
        </output>
      )}

      <div>
        <h4 {...stylex.props(ui.sub)}>Connected</h4>
        {loading ? (
          <p {...stylex.props(ui.none)}>Loading hosts</p>
        ) : connections.length === 0 ? (
          <p {...stylex.props(ui.none)}>{`No ${provider.label} account is connected yet.`}</p>
        ) : (
          <ul {...stylex.props(ui.list)}>
            {connections.map((connection) => (
              <li key={connection.id} {...stylex.props(ui.item)}>
                <span {...stylex.props(ui.who)}>
                  <Text type="label" weight="medium" maxLines={1}>
                    {connection.accountLogin}
                  </Text>
                  <span {...stylex.props(ui.mono, ui.dim, ui.clip)}>
                    {`${addressOf(connection)} · ${accessLabel(connection)}`}
                  </span>
                </span>
                {webhookPath(connection) !== null && (
                  <span {...stylex.props(ui.hook)}>
                    <span {...stylex.props(ui.mono, ui.dim, ui.clip)}>
                      {webhookPath(connection)}
                    </span>
                    <CopyButton value={webhookPath(connection) ?? ''} label="Payload URL" />
                  </span>
                )}
                <span {...stylex.props(ui.age)}>{age(connection.createdAt)}</span>
                <Button
                  label="Disconnect"
                  size="sm"
                  variant="ghost"
                  isDisabled={model.busy}
                  onClick={() => setLeaving(connection)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h4 {...stylex.props(ui.sub)}>
          {connections.length === 0 ? 'Connect' : 'Connect another'}
        </h4>
        {app && (
          <div {...stylex.props(ui.lead)}>
            <div {...stylex.props(ui.leadText)}>
              <Text type="label" weight="medium">
                Install the GitHub App
              </Text>
              <Text type="supporting" color="secondary">
                Watches GitHub without a personal token, and there is no webhook to set up.
              </Text>
            </div>
            <Button
              label="Install"
              size="sm"
              variant="primary"
              endContent={<Icon icon={ExternalLink} size="sm" />}
              onClick={() => window.open(model.github?.url ?? '', '_blank', 'noopener')}
            />
          </div>
        )}
        <TokenForm provider={provider} model={model} behindDisclosure={app} />
      </div>

      {leaving !== null && (
        <AlertDialog
          isOpen
          onOpenChange={(open) => {
            if (!open) setLeaving(null);
          }}
          title={`Disconnect ${leaving.accountLogin}?`}
          description={`${providerLabel(leaving.provider)} at ${addressOf(leaving)} stops being watched.`}
          actionLabel="Disconnect"
          onAction={() => {
            void model.disconnect(leaving.id);
            setLeaving(null);
          }}
        />
      )}
    </section>
  );
}

function TokenForm({
  provider,
  model,
  behindDisclosure,
}: {
  provider: Provider;
  model: HostsModel;
  behindDisclosure: boolean;
}) {
  const [open, setOpen] = useState(!behindDisclosure);
  const [instanceUrl, setInstanceUrl] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [accountLogin, setAccountLogin] = useState('');
  const input = { provider: provider.value, instanceUrl, accessToken, accountLogin };
  const ready = canConnect(input) && !model.busy;
  const address = needsAddress(provider.value);

  async function connect(): Promise<void> {
    if (!ready) return;
    if (await model.connect(input)) {
      setInstanceUrl('');
      setAccessToken('');
      setAccountLogin('');
    }
  }

  return (
    <div>
      {behindDisclosure && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          {...stylex.props(ui.disclose)}
        >
          <Icon icon={open ? ChevronDown : ChevronRight} size="sm" />
          Use a personal access token instead
        </button>
      )}
      {open && (
        <div {...stylex.props(ui.fields)}>
          <TextInput
            label={provider.value === 'github' ? 'GitHub Enterprise address' : 'Server address'}
            value={instanceUrl}
            placeholder={provider.example}
            isOptional={!address}
            isRequired={address}
            size="sm"
            onChange={setInstanceUrl}
          />
          <div {...stylex.props(ui.pair)}>
            <TextInput
              label="Access token"
              type="password"
              value={accessToken}
              isRequired
              size="sm"
              onChange={setAccessToken}
              onEnter={() => void connect()}
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
          <div {...stylex.props(ui.foot)}>
            <Button
              label={model.busy ? 'Connecting' : `Connect ${provider.label}`}
              size="sm"
              variant={behindDisclosure ? 'secondary' : 'primary'}
              isDisabled={!ready}
              onClick={() => void connect()}
            />
          </div>
        </div>
      )}
    </div>
  );
}

const ui = stylex.create({
  page: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-5'] },
  intro: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-1'],
    maxWidth: 640,
  },
  split: {
    display: 'grid',
    gridTemplateColumns: '208px minmax(0, 1fr)',
    minHeight: 440,
    borderBlockStartWidth: borderVars['--border-width'],
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: colorVars['--color-border'],
  },
  rail: {
    display: 'flex',
    flexDirection: 'column',
    paddingBlock: spacingVars['--spacing-2'],
    paddingInlineEnd: spacingVars['--spacing-2'],
    borderInlineEndWidth: borderVars['--border-width'],
    borderInlineEndStyle: 'solid',
    borderInlineEndColor: colorVars['--color-border'],
  },
  railRow: {
    display: 'grid',
    gridTemplateColumns: '16px minmax(0, 1fr) auto',
    alignItems: 'center',
    columnGap: spacingVars['--spacing-2'],
    height: 36,
    paddingInline: 0,
    border: 0,
    borderRadius: radiusVars['--radius-element'],
    background: { default: 'transparent', ':hover': colorVars['--color-overlay-hover'] },
    color: colorVars['--color-text-primary'],
    font: 'inherit',
    fontSize: textSizeVars['--font-size-base'],
    textAlign: 'start',
    cursor: 'pointer',
    outlineStyle: { default: 'none', ':focus-visible': focusVars['--focus-outline-style'] },
    outlineWidth: focusVars['--focus-outline-width'],
    outlineColor: focusVars['--focus-outline-color'],
  },
  railOn: { backgroundColor: colorVars['--color-background-muted'], fontWeight: 600 },
  dot: {
    justifySelf: 'center',
    width: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: 'transparent',
  },
  dotOn: { backgroundColor: colorVars['--color-accent'] },
  railName: { minWidth: 0 },
  railCount: {
    paddingInlineEnd: spacingVars['--spacing-2'],
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-sm'],
    fontWeight: 400,
    color: colorVars['--color-text-secondary'],
    fontVariantNumeric: 'tabular-nums',
  },
  railNone: { opacity: 0.5 },
  pane: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-6'],
    paddingBlock: spacingVars['--spacing-3'],
    paddingInlineStart: spacingVars['--spacing-6'],
    minWidth: 0,
  },
  paneHead: { display: 'flex', alignItems: 'baseline', gap: spacingVars['--spacing-3'] },
  sub: {
    margin: 0,
    paddingBlockEnd: spacingVars['--spacing-2'],
    borderBlockEndWidth: borderVars['--border-width'],
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-border'],
    fontSize: textSizeVars['--font-size-sm'],
    fontWeight: 500,
    color: colorVars['--color-text-secondary'],
  },
  none: {
    margin: 0,
    paddingBlock: spacingVars['--spacing-3'],
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
  },
  list: { margin: 0, padding: 0, listStyle: 'none' },
  item: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.1fr) 40px auto',
    alignItems: 'center',
    columnGap: spacingVars['--spacing-3'],
    minHeight: 52,
    borderBlockEndWidth: borderVars['--border-width'],
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-border'],
  },
  who: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, gridColumn: 1 },
  hook: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-1'],
    minWidth: 0,
    gridColumn: 2,
  },
  age: {
    gridColumn: 3,
    textAlign: 'end',
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
    fontVariantNumeric: 'tabular-nums',
  },
  mono: {
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-sm'],
  },
  dim: { color: colorVars['--color-text-secondary'] },
  clip: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  lead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingVars['--spacing-4'],
    paddingBlock: spacingVars['--spacing-3'],
    borderBlockEndWidth: borderVars['--border-width'],
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-border'],
  },
  leadText: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
  disclose: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-1'],
    height: 32,
    marginBlockStart: spacingVars['--spacing-2'],
    paddingInline: 0,
    border: 0,
    background: 'transparent',
    color: colorVars['--color-text-secondary'],
    font: 'inherit',
    fontSize: textSizeVars['--font-size-sm'],
    cursor: 'pointer',
    outlineStyle: { default: 'none', ':focus-visible': focusVars['--focus-outline-style'] },
    outlineWidth: focusVars['--focus-outline-width'],
    outlineColor: focusVars['--focus-outline-color'],
  },
  fields: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-3'],
    paddingBlockStart: spacingVars['--spacing-3'],
    maxWidth: 520,
  },
  pair: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
    gap: spacingVars['--spacing-3'],
    alignItems: 'start',
  },
  foot: { display: 'flex', justifyContent: 'flex-end' },
  secret: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-2'],
    paddingBlock: spacingVars['--spacing-3'],
    borderBlockStartWidth: 2,
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: colorVars['--color-warning'],
  },
  secretLine: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
  },
});
