/**
 * PROTOTYPE — Git hosts, variant C: a table, and a two-step connect.
 *
 * The page is only what is connected, as one table whose columns include each host's webhook
 * (the thing a person comes back for). Connecting is a dialog, because it ends in the one
 * moment that cannot be repeated: the webhook secret, shown once. The dialog's second step is
 * that moment — it cannot be left until the secret has been copied.
 */
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Dialog } from '@astryxdesign/core/Dialog';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { Heading } from '@astryxdesign/core/Heading';
import { Icon } from '@astryxdesign/core/Icon';
import { Selector } from '@astryxdesign/core/Selector';
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
import { ExternalLink, MoreHorizontal, Plus } from 'lucide-react';
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
import { FlushDialogHeader } from './dialogHeader';
import { CopyButton } from './gitHostsParts';
import { age } from './workRows';

const pad = 0;

const PROVIDER_NOTES: Record<string, string> = {
  github: 'github.com or GitHub Enterprise',
  gitlab: 'gitlab.com or self-managed',
  forgejo: 'Self-hosted',
  gitea: 'Self-hosted',
};

export function VariantC({ model }: { model: HostsModel }) {
  const { connections, trouble, github } = model;
  const [adding, setAdding] = useState(false);
  const [leaving, setLeaving] = useState<GitConnection | null>(null);

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
        <div {...stylex.props(ui.headActions)}>
          {github?.configured === true && github.url !== null && (
            <Button
              label="Install the GitHub App"
              size="sm"
              variant="secondary"
              endContent={<Icon icon={ExternalLink} size="sm" />}
              onClick={() => window.open(github.url ?? '', '_blank', 'noopener')}
            />
          )}
          <Button
            label="Connect a host"
            size="sm"
            variant="primary"
            icon={<Icon icon={Plus} size="sm" />}
            onClick={() => setAdding(true)}
          />
        </div>
      </header>

      {trouble !== null && !adding && (
        <Banner status="error" title="Git hosts" description={trouble} />
      )}

      {connections === null ? (
        <div aria-busy="true" {...stylex.props(ui.waiting)}>
          <Skeleton width="100%" height={40} />
          <Skeleton width="100%" height={40} index={1} />
        </div>
      ) : connections.length === 0 ? (
        <div {...stylex.props(ui.none)}>
          <Text type="label" weight="medium">
            No hosts are connected
          </Text>
          <Text type="supporting" color="secondary">
            Connect GitHub, GitLab, Forgejo or Gitea and Kira watches the repositories your projects
            attach from it.
          </Text>
        </div>
      ) : (
        <table aria-label="Connected Git hosts" {...stylex.props(ui.table)}>
          <thead {...stylex.props(ui.contents)}>
            <tr {...stylex.props(ui.row, ui.headRow)}>
              <th scope="col" {...stylex.props(ui.th, ui.c1)}>
                Account
              </th>
              <th scope="col" {...stylex.props(ui.th, ui.c2)}>
                Host
              </th>
              <th scope="col" {...stylex.props(ui.th, ui.c3)}>
                Access
              </th>
              <th scope="col" {...stylex.props(ui.th, ui.c4)}>
                Webhook
              </th>
              <th scope="col" {...stylex.props(ui.th, ui.c5, ui.end)}>
                Connected
              </th>
            </tr>
          </thead>
          <tbody {...stylex.props(ui.contents)}>
            {connections.map((connection) => (
              <Line
                key={connection.id}
                connection={connection}
                onDisconnect={() => setLeaving(connection)}
              />
            ))}
          </tbody>
        </table>
      )}

      {(adding || model.secret !== null) && (
        <ConnectDialog model={model} onClose={() => setAdding(false)} />
      )}

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
    </div>
  );
}

function Line({
  connection,
  onDisconnect,
}: {
  connection: GitConnection;
  onDisconnect: () => void;
}) {
  const path = webhookPath(connection);

  return (
    <tr {...stylex.props(ui.row, ui.bodyRow)}>
      <td {...stylex.props(ui.c1, ui.cell)}>
        <Text type="label" weight="medium" maxLines={1}>
          {connection.accountLogin}
        </Text>
        <span {...stylex.props(ui.dim, ui.small)}>{connection.accountType}</span>
      </td>
      <td {...stylex.props(ui.c2, ui.cell)}>
        <Text type="label" maxLines={1}>
          {providerLabel(connection.provider)}
        </Text>
        <span {...stylex.props(ui.mono, ui.dim, ui.clip)}>{addressOf(connection)}</span>
      </td>
      <td {...stylex.props(ui.c3, ui.dim, ui.small)}>{accessLabel(connection)}</td>
      <td {...stylex.props(ui.c4, ui.hook)}>
        {path === null ? (
          <span {...stylex.props(ui.dim, ui.small)}>Through the App</span>
        ) : (
          <>
            <span {...stylex.props(ui.mono, ui.dim, ui.clip)} title={path}>
              {path}
            </span>
            <CopyButton value={path} label="Payload URL" />
          </>
        )}
      </td>
      <td {...stylex.props(ui.c5, ui.age)}>{age(connection.createdAt)}</td>
      <td {...stylex.props(ui.c6)}>
        <DropdownMenu
          button={{
            label: `Actions for ${connection.accountLogin}`,
            icon: <Icon icon={MoreHorizontal} size="sm" />,
            isIconOnly: true,
            variant: 'ghost',
            size: 'sm',
            tooltip: 'Actions',
          }}
          items={[{ id: 'disconnect', label: 'Disconnect…', onClick: onDisconnect }]}
        />
      </td>
    </tr>
  );
}

function ConnectDialog({ model, onClose }: { model: HostsModel; onClose: () => void }) {
  const { secret } = model;
  const [provider, setProvider] = useState('github');
  const [instanceUrl, setInstanceUrl] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [accountLogin, setAccountLogin] = useState('');
  const [copied, setCopied] = useState(false);
  const input = { provider, instanceUrl, accessToken, accountLogin };
  const ready = canConnect(input) && !model.busy;
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
            <Selector
              label="Host"
              options={PROVIDERS.map((each) => ({
                value: each.value,
                label: each.label,
                description: PROVIDER_NOTES[each.value],
              }))}
              value={provider}
              isDisabled={model.busy}
              onChange={(value) => setProvider(value ?? 'github')}
            />
            <TextInput
              label="Address"
              value={instanceUrl}
              placeholder={PROVIDERS.find((each) => each.value === provider)?.example}
              isOptional={!needsAddress(provider)}
              isRequired={needsAddress(provider)}
              size="sm"
              onChange={setInstanceUrl}
            />
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
                <span {...stylex.props(ui.mono, ui.clip)}>{`/api/webhooks/git/${secret.id}`}</span>
                <CopyButton value={`/api/webhooks/git/${secret.id}`} label="Payload URL" />
              </div>
              <div {...stylex.props(ui.secretRow)}>
                <span {...stylex.props(ui.secretName)}>Secret</span>
                <span {...stylex.props(ui.mono, ui.clip)}>{secret.value}</span>
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
  page: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-5'] },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: spacingVars['--spacing-4'],
    flexWrap: 'wrap',
  },
  intro: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-1'],
    flex: 1,
    minWidth: 280,
  },
  headActions: { display: 'flex', gap: spacingVars['--spacing-2'], alignItems: 'center' },
  waiting: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-2'] },
  none: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-1'],
    paddingBlock: spacingVars['--spacing-4'],
    paddingInline: pad,
    borderBlockStartWidth: borderVars['--border-width'],
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: colorVars['--color-border'],
    borderBlockEndWidth: borderVars['--border-width'],
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-border'],
  },
  table: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 1.1fr) 104px minmax(0, 1.5fr) 72px 40px',
    borderBlockStartWidth: borderVars['--border-width'],
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: colorVars['--color-border'],
  },
  row: {
    display: 'grid',
    gridColumn: '1 / -1',
    gridTemplateColumns: 'subgrid',
    alignItems: 'center',
    columnGap: spacingVars['--spacing-3'],
    borderBlockEndWidth: borderVars['--border-width'],
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-border'],
  },
  headRow: { height: 32 },
  bodyRow: { minHeight: 56 },
  th: {
    fontSize: textSizeVars['--font-size-sm'],
    fontWeight: 500,
    color: colorVars['--color-text-secondary'],
  },
  end: { textAlign: 'end' },
  c1: { gridColumn: 1, minWidth: 0, padding: 0, textAlign: 'start' },
  c2: { gridColumn: 2, minWidth: 0, padding: 0, textAlign: 'start' },
  c3: { gridColumn: 3, padding: 0, textAlign: 'start' },
  c4: { gridColumn: 4, minWidth: 0, padding: 0, textAlign: 'start' },
  c5: { gridColumn: 5, padding: 0 },
  c6: { gridColumn: 6, display: 'flex', justifyContent: 'flex-end', padding: 0 },
  contents: { display: 'contents' },
  cell: { display: 'flex', flexDirection: 'column', gap: 2 },
  hook: { display: 'flex', alignItems: 'center', gap: spacingVars['--spacing-1'] },
  age: {
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
  small: { fontSize: textSizeVars['--font-size-sm'] },
  clip: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-3'],
    paddingBlock: spacingVars['--spacing-2'],
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
});
