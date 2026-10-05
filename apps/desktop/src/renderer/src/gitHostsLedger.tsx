/**
 * The Git hosts page: one ruled column, drawn the way Work and the chat rail are. Connected
 * hosts are rows on one grid; disconnecting is asked in the row itself. Connecting is a dialog
 * the page asks for (`onConnect`) and does not own.
 */
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { Icon } from '@astryxdesign/core/Icon';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Text } from '@astryxdesign/core/Text';
import {
  borderVars,
  colorVars,
  spacingVars,
  textSizeVars,
  typographyVars,
} from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { Building2, Plus, User } from 'lucide-react';
import { useState } from 'react';
import type { GitConnection } from '../../preload/bridge';
import {
  accessLabel,
  addressOf,
  providerLabel,
  webhookPath,
  type HostsModel,
} from './gitHostsModel';
import { age } from './workRows';

export function HostsLedger({ model, onConnect }: { model: HostsModel; onConnect: () => void }) {
  const { connections, trouble } = model;
  const empty = connections !== null && connections.length === 0;

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
        <Button
          label="Connect a host"
          size="sm"
          variant="primary"
          icon={<Icon icon={Plus} size="sm" />}
          onClick={onConnect}
        />
      </header>

      {trouble !== null && <Banner status="error" title="Git hosts" description={trouble} />}

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
    paddingBlock: spacingVars['--spacing-2'],
  },
  none: {
    margin: 0,
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
});
