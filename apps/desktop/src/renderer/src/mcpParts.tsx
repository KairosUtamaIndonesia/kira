/**
 * PROTOTYPE — the small pieces the MCP variants share (a server's status, its tool checklist,
 * its action menu), so they differ in layout and not in behavior. Wipe me with them.
 */
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { Heading } from '@astryxdesign/core/Heading';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { colorVars, spacingVars, textSizeVars } from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowLeft, MoreHorizontal } from 'lucide-react';
import type { McpServer } from '../../preload/bridge';
import { kindOf, statusOf, toolsOf, type McpModel, type Tone } from './mcpModel';

export const BADGE: Record<Tone, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  success: 'success',
  warning: 'warning',
  error: 'error',
  accent: 'info',
  neutral: 'neutral',
};

/** What a server's page is handed: the server (null for Add), and the ways out of it. */
export interface PageProps {
  model: McpModel;
  server: McpServer | null;
  onBack: () => void;
  /** A new server was saved; the page it made is next. */
  onSaved: (saved: McpServer) => void;
  onRemove: () => void;
}

/** A status as a dot and its word: color never carries the meaning alone. */
export function Status({ server }: { server: McpServer }) {
  const { label, tone } = statusOf(server);
  return (
    <span {...stylex.props(ui.status)}>
      <StatusDot variant={tone} label={label} isPulsing={server.status === 'connecting'} />
      <span>{label}</span>
    </span>
  );
}

/** Which tools of a server Kira may call: all of them, or a chosen few. */
export function Tools({ server, model }: { server: McpServer; model: McpModel }) {
  if (server.tools.length === 0) {
    return (
      <Text type="supporting" color="secondary">
        {server.status === 'connected'
          ? 'This server offers no tools.'
          : 'No tools yet. They appear once the server connects.'}
      </Text>
    );
  }

  return (
    <div {...stylex.props(ui.tools)}>
      <CheckboxInput
        label="Use all tools"
        description="New tools this server adds are available automatically."
        value={server.toolSelection === 'all'}
        isDisabled={model.busy}
        changeAction={(all) =>
          model.setTools(
            server,
            all ? 'all' : server.tools.filter((tool) => tool.selected).map((tool) => tool.toolName),
          )
        }
      />
      <div {...stylex.props(ui.toolGrid)}>
        {server.tools.map((tool) => (
          <CheckboxInput
            key={tool.name}
            label={tool.toolName}
            description={tool.description}
            value={tool.selected}
            isDisabled={model.busy || server.toolSelection === 'all'}
            changeAction={(enabled) => {
              const selected =
                server.toolSelection === 'all'
                  ? server.tools.map((candidate) => candidate.toolName)
                  : [...server.toolSelection];
              return model.setTools(
                server,
                enabled
                  ? [...new Set([...selected, tool.toolName])]
                  : selected.filter((name) => name !== tool.toolName),
              );
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** What can be done to a server besides switching it on or off. */
export function ServerMenu({
  server,
  model,
  onEdit,
  onRemove,
}: {
  server: McpServer;
  model: McpModel;
  onEdit?: () => void;
  onRemove: () => void;
}) {
  const canSignIn =
    server.transport === 'streamable-http' &&
    server.enabled &&
    (!server.hasOAuth || server.status === 'needs-sign-in');
  const canSignOut = server.hasOAuth || server.oauthCredentialsPersisted;
  const items = [
    ...(server.enabled
      ? [
          {
            id: 'reconnect',
            label: server.status === 'connected' ? 'Reconnect' : 'Connect',
            onClick: () => void model.reconnect(server),
          },
        ]
      : []),
    ...(canSignIn
      ? [{ id: 'sign-in', label: 'Sign in', onClick: () => void model.signIn(server) }]
      : []),
    ...(canSignOut
      ? [{ id: 'sign-out', label: 'Sign out', onClick: () => void model.signOut(server) }]
      : []),
    ...(onEdit === undefined ? [] : [{ id: 'edit', label: 'Edit…', onClick: onEdit }]),
    { id: 'remove', label: 'Remove…', onClick: onRemove },
  ];

  return (
    <DropdownMenu
      button={{
        label: `Actions for ${server.name}`,
        icon: <Icon icon={MoreHorizontal} size="sm" />,
        isIconOnly: true,
        variant: 'ghost',
        size: 'sm',
        tooltip: 'Actions',
      }}
      items={items}
    />
  );
}

/** What is wrong with a server, said where it can be fixed. */
export function Notices({ server, model }: { server: McpServer; model: McpModel }) {
  return (
    <>
      {server.status === 'failed' && server.error !== null && (
        <Banner
          status="error"
          title="The server did not start"
          description={server.error}
          endContent={
            <Button
              label="Try again"
              size="sm"
              variant="secondary"
              isDisabled={model.busy}
              onClick={() => void model.reconnect(server)}
            />
          }
        />
      )}
      {server.status === 'needs-sign-in' && (
        <Banner
          status="warning"
          title="This server needs you to sign in"
          endContent={
            <Button
              label="Sign in"
              size="sm"
              variant="secondary"
              isDisabled={model.busy}
              onClick={() => void model.signIn(server)}
            />
          }
        />
      )}
    </>
  );
}

/** The top of a server's page: back, its name and status, whether it is on, and its menu. */
export function ServerHead({
  server,
  model,
  onBack,
  onRemove,
}: {
  server: McpServer | null;
  model: McpModel;
  onBack: () => void;
  onRemove: () => void;
}) {
  const status = server === null ? null : statusOf(server);

  return (
    <header {...stylex.props(ui.head)}>
      <IconButton
        label="Back to servers"
        icon={<Icon icon={ArrowLeft} size="sm" />}
        size="sm"
        variant="ghost"
        onClick={onBack}
      />
      <div {...stylex.props(ui.headText)}>
        <span {...stylex.props(ui.titleRow)}>
          <Heading level={2}>{server === null ? 'New MCP server' : server.name}</Heading>
          {status !== null && <Badge label={status.label} variant={BADGE[status.tone]} />}
        </span>
        <Text color="secondary" size="sm">
          {server === null
            ? 'Configure a new MCP server.'
            : `${kindOf(server)} server · ${toolsOf(server)}`}
        </Text>
      </div>
      {server !== null && (
        <>
          <Switch
            label="Enabled"
            value={server.enabled}
            changeAction={(enabled) => model.setEnabled(server, enabled)}
          />
          <ServerMenu server={server} model={model} onRemove={onRemove} />
        </>
      )}
    </header>
  );
}

const ui = stylex.create({
  status: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
    whiteSpace: 'nowrap',
  },
  head: { display: 'flex', alignItems: 'center', gap: spacingVars['--spacing-3'] },
  headText: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-1'],
    flex: 1,
    minWidth: 0,
  },
  titleRow: { display: 'flex', alignItems: 'center', gap: spacingVars['--spacing-3'] },
  tools: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-3'] },
  toolGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    columnGap: spacingVars['--spacing-4'],
    rowGap: spacingVars['--spacing-3'],
    maxHeight: 360,
    overflowY: 'auto',
  },
});
