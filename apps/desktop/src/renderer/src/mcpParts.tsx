/**
 * PROTOTYPE — the small pieces the MCP variants share (a server's status, its tool checklist,
 * its action menu), so they differ in layout and not in behavior. Wipe me with them.
 */
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { Icon } from '@astryxdesign/core/Icon';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Text } from '@astryxdesign/core/Text';
import { colorVars, spacingVars, textSizeVars } from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { MoreHorizontal } from 'lucide-react';
import type { McpServer } from '../../preload/bridge';
import { statusOf, type McpModel } from './mcpModel';

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
  onEdit: () => void;
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
    { id: 'edit', label: 'Edit…', onClick: onEdit },
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

const ui = stylex.create({
  status: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
    whiteSpace: 'nowrap',
  },
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
