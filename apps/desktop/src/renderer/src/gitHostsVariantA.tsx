/**
 * PROTOTYPE — Git hosts, variant A: the ledger.
 *
 * One ruled column, drawn the way Work and the chat rail are. Connected hosts are rows on one
 * grid; connecting is a section that opens beneath them, and is open from the start when
 * there is nothing yet. Disconnecting is asked in the row itself.
 */
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { Icon } from '@astryxdesign/core/Icon';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Skeleton } from '@astryxdesign/core/Skeleton';
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
import { Building2, ExternalLink, User } from 'lucide-react';
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
} from './gitHostsModel';
import { CopyButton } from './gitHostsParts';
import { age } from './workRows';

const pad = 0;

export function VariantA({ model }: { model: HostsModel }) {
  const { connections, trouble, secret, github } = model;
  const [opened, setOpened] = useState(false);
  const empty = connections !== null && connections.length === 0;
  const adding = opened || empty;

  return (
    <div {...stylex.props(ui.page)}>
      <header {...stylex.props(ui.header)}>
        <div {...stylex.props(ui.intro)}>
          <Heading level={2}>Git hosts</Heading>
          <Text color="secondary" size="sm">
            A repository is watched once it is attached to a project, and its host is connected
            here. Connecting needs an administrator and a personal access token.
          </Text>
        </div>
        {!adding && (
          <Button
            label="Connect a host"
            size="sm"
            variant="primary"
            onClick={() => setOpened(true)}
          />
        )}
      </header>

      {trouble !== null && <Banner status="error" title="Git hosts" description={trouble} />}

      {secret !== null && (
        <section aria-label="Webhook secret" {...stylex.props(ui.secret)}>
          <div {...stylex.props(ui.secretHead)}>
            <Text type="label" weight="medium">
              Webhook secret
            </Text>
            <span {...stylex.props(ui.once)}>Shown once</span>
            <span {...stylex.props(ui.spacer)} />
            <Button label="Done" size="sm" variant="secondary" onClick={model.dismissSecret} />
          </div>
          <SecretLine name="Secret" value={secret.value} />
          <SecretLine name="Payload URL" value={`/api/webhooks/git/${secret.id}`} />
        </section>
      )}

      <section aria-labelledby="git-hosts-connected">
        <div {...stylex.props(ui.sectionHead)}>
          <Heading level={3} id="git-hosts-connected">
            Connected
          </Heading>
          <span {...stylex.props(ui.count)}>
            {String(connections?.length ?? 0).padStart(2, '0')}
          </span>
        </div>
        {connections === null ? (
          <div aria-busy="true" {...stylex.props(ui.waiting)}>
            <Skeleton width="40%" height={16} />
            <Skeleton width="65%" height={16} index={1} />
          </div>
        ) : empty ? (
          <p {...stylex.props(ui.none)}>
            No hosts are connected. Connect one and Kira watches the repositories your projects
            attach from it.
          </p>
        ) : (
          <ul {...stylex.props(ui.ledger)}>
            {connections.map((connection) => (
              <Row key={connection.id} connection={connection} model={model} />
            ))}
          </ul>
        )}
      </section>

      {adding && (
        <ConnectSection model={model} onClose={empty ? undefined : () => setOpened(false)} />
      )}

      {github?.configured === true && github.url !== null && (
        <div {...stylex.props(ui.appRow)}>
          <Text type="supporting" color="secondary">
            Install the GitHub App to watch GitHub without a personal token.
          </Text>
          <Button
            label="Install the GitHub App"
            size="sm"
            variant="secondary"
            endContent={<Icon icon={ExternalLink} size="sm" />}
            onClick={() => window.open(github.url ?? '', '_blank', 'noopener')}
          />
        </div>
      )}
    </div>
  );
}

function SecretLine({ name, value }: { name: string; value: string }) {
  return (
    <div {...stylex.props(ui.secretLine)}>
      <Text type="supporting" color="secondary">
        {name}
      </Text>
      <span {...stylex.props(ui.mono, ui.clip)} title={value}>
        {value}
      </span>
      <CopyButton value={value} label={name} />
    </div>
  );
}

function Row({ connection, model }: { connection: GitConnection; model: HostsModel }) {
  const [asking, setAsking] = useState(false);
  const path = webhookPath(connection);

  return (
    <li {...stylex.props(ui.row)}>
      <span {...stylex.props(ui.glyph)}>
        <Icon
          icon={connection.accountType === 'Organization' ? Building2 : User}
          size="sm"
          color="secondary"
        />
      </span>
      <span {...stylex.props(ui.who)}>
        <Text type="label" weight="medium" maxLines={1}>
          {connection.accountLogin}
        </Text>
        <span {...stylex.props(ui.mono, ui.dim, ui.clip)}>
          {`${providerLabel(connection.provider)} · ${addressOf(connection)}`}
        </span>
      </span>
      {asking ? (
        <span {...stylex.props(ui.ask)}>Its repositories stop being watched.</span>
      ) : (
        <>
          <span
            {...stylex.props(ui.how)}
            title={path ?? 'Arrives on the server’s shared GitHub webhook'}
          >
            {accessLabel(connection)}
          </span>
          <span {...stylex.props(ui.age)}>{age(connection.createdAt)}</span>
        </>
      )}
      <span {...stylex.props(ui.actions)}>
        {asking ? (
          <>
            <Button label="Keep" size="sm" variant="ghost" onClick={() => setAsking(false)} />
            <Button
              label="Disconnect"
              size="sm"
              variant="destructive"
              isDisabled={model.busy}
              onClick={() => void model.disconnect(connection.id)}
            />
          </>
        ) : (
          <Button label="Disconnect" size="sm" variant="ghost" onClick={() => setAsking(true)} />
        )}
      </span>
    </li>
  );
}

function ConnectSection({ model, onClose }: { model: HostsModel; onClose?: () => void }) {
  const [provider, setProvider] = useState('github');
  const [instanceUrl, setInstanceUrl] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [accountLogin, setAccountLogin] = useState('');
  const input = { provider, instanceUrl, accessToken, accountLogin };
  const ready = canConnect(input) && !model.busy;
  const chosen = PROVIDERS.find((each) => each.value === provider);

  async function connect(): Promise<void> {
    if (!ready) return;
    if (await model.connect(input)) {
      setAccessToken('');
      setAccountLogin('');
      setInstanceUrl('');
      onClose?.();
    }
  }

  return (
    <section aria-labelledby="git-hosts-connect">
      <div {...stylex.props(ui.sectionHead)}>
        <Heading level={3} id="git-hosts-connect">
          Connect a host
        </Heading>
      </div>
      <div {...stylex.props(ui.form)}>
        <SegmentedControl
          label="Host"
          value={provider}
          onChange={setProvider}
          size="sm"
          layout="fill"
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
        <div {...stylex.props(ui.foot)}>
          {onClose && <Button label="Cancel" size="sm" variant="ghost" onClick={onClose} />}
          <Button
            label={model.busy ? 'Connecting' : 'Connect host'}
            size="sm"
            variant="primary"
            isDisabled={!ready}
            onClick={() => void connect()}
          />
        </div>
      </div>
    </section>
  );
}

const ui = stylex.create({
  page: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-6'] },
  header: { display: 'flex', alignItems: 'flex-start', gap: spacingVars['--spacing-4'] },
  intro: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-1'],
    flex: 1,
    minWidth: 0,
  },
  sectionHead: {
    display: 'flex',
    alignItems: 'baseline',
    gap: spacingVars['--spacing-2'],
    paddingBlockStart: spacingVars['--spacing-3'],
    paddingBlockEnd: spacingVars['--spacing-2'],
    paddingInline: pad,
    borderBlockStartWidth: borderVars['--border-width'],
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: colorVars['--color-border'],
  },
  count: {
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
    fontVariantNumeric: 'tabular-nums',
  },
  waiting: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-2'],
    paddingInline: pad,
    paddingBlock: spacingVars['--spacing-2'],
  },
  none: {
    margin: 0,
    paddingInline: pad,
    paddingBlock: spacingVars['--spacing-2'],
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
    maxWidth: '60ch',
  },
  ledger: {
    display: 'grid',
    gridTemplateColumns: '20px minmax(0, 1fr) 112px 40px 168px',
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  row: {
    display: 'grid',
    gridColumn: '1 / -1',
    gridTemplateColumns: 'subgrid',
    alignItems: 'center',
    columnGap: spacingVars['--spacing-3'],
    minHeight: 52,
    borderBlockEndWidth: borderVars['--border-width'],
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-border'],
  },
  glyph: { gridColumn: 1, display: 'inline-flex' },
  who: { gridColumn: 2, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
  how: {
    gridColumn: 3,
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
  },
  age: {
    gridColumn: 4,
    textAlign: 'end',
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
    fontVariantNumeric: 'tabular-nums',
  },
  ask: {
    gridColumn: '3 / 5',
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
  },
  actions: {
    gridColumn: 5,
    display: 'flex',
    justifyContent: 'flex-end',
    gap: spacingVars['--spacing-1'],
  },
  mono: {
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-sm'],
  },
  dim: { color: colorVars['--color-text-secondary'] },
  clip: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-3'],
    paddingInline: pad,
    paddingBlockStart: spacingVars['--spacing-2'],
    maxWidth: 560,
  },
  pair: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
    gap: spacingVars['--spacing-3'],
    alignItems: 'start',
  },
  foot: { display: 'flex', justifyContent: 'flex-end', gap: spacingVars['--spacing-2'] },
  appRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingVars['--spacing-4'],
    paddingInline: pad,
    paddingBlock: spacingVars['--spacing-3'],
    borderBlockStartWidth: borderVars['--border-width'],
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: colorVars['--color-border'],
  },
  secret: {
    borderBlockStartWidth: 2,
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: colorVars['--color-warning'],
    paddingBlockEnd: spacingVars['--spacing-2'],
    backgroundColor: colorVars['--color-background-muted'],
  },
  secretHead: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    paddingInline: spacingVars['--spacing-4'],
    paddingBlock: spacingVars['--spacing-2'],
  },
  once: {
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
  },
  spacer: { flex: 1 },
  secretLine: {
    display: 'grid',
    gridTemplateColumns: '96px minmax(0, 1fr) auto',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    paddingInline: spacingVars['--spacing-4'],
    minHeight: 36,
  },
});
