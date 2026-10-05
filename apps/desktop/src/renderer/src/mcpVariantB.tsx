/**
 * PROTOTYPE — MCP servers, variant B: a list and its detail.
 *
 * A rail lists every server with its status dot, grouped by where it is offered, with Add a
 * server at the top. The pane beside it is the selected server: its status and switch, its
 * tools, and how it is reached, with Edit turning that last part into the form in place.
 */
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { Icon } from '@astryxdesign/core/Icon';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Switch } from '@astryxdesign/core/Switch';
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
import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import type { McpServer } from '../../preload/bridge';
import { ConfirmRemove, McpServerForm, useServerEditor } from './mcpForm';
import { groupByScope, kindOf, matches, reachOf, scopeLabel, statusOf, toolsOf } from './mcpModel';
import { ServerMenu, Status, Tools } from './mcpParts';
import type { VariantProps } from './mcpSection';

export function McpVariantB({ model }: VariantProps) {
  const { servers, problem } = model;
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState<McpServer | null>(null);

  const all = servers ?? [];
  const groups = groupByScope(
    all.filter((each) => matches(each, query)),
    model.workspaces,
  ).filter((group) => group.servers.length > 0);
  // Open on the first server, or on the form when there is none to open.
  const current: McpServer | 'new' | undefined =
    picked === 'new' ? 'new' : (all.find((each) => each.id === picked) ?? all[0] ?? 'new');

  const choose = (id: string): void => {
    setPicked(id);
    setEditing(false);
    model.clearProblem();
  };

  return (
    <div {...stylex.props(ui.page)}>
      <div {...stylex.props(ui.intro)}>
        <Heading level={2}>MCP servers</Heading>
        <Text color="secondary" size="sm">
          Give Kira tools from Model Context Protocol servers. A server is offered in every chat, or
          only in the chats of one workspace.
        </Text>
      </div>

      {problem !== null && editing === false && current !== 'new' && (
        <Banner status="error" title="MCP servers" description={problem} />
      )}

      <div {...stylex.props(ui.split)}>
        <nav aria-label="MCP servers" {...stylex.props(ui.rail)}>
          <TextInput
            label="Search servers"
            isLabelHidden
            value={query}
            placeholder="Search servers"
            size="sm"
            startIcon={Search}
            hasClear
            onChange={setQuery}
          />
          <button
            type="button"
            aria-current={current === 'new' ? 'true' : undefined}
            onClick={() => choose('new')}
            {...stylex.props(ui.item, current === 'new' && ui.itemOn)}
          >
            <Icon icon={Plus} size="sm" color="secondary" />
            <span {...stylex.props(ui.itemName)}>Add a server</span>
          </button>
          {servers === null && <p {...stylex.props(ui.dim)}>Loading servers</p>}
          {groups.map((group) => (
            <div key={group.id} {...stylex.props(ui.group)}>
              <div {...stylex.props(ui.groupHead)}>
                <span>{group.label}</span>
                <span {...stylex.props(ui.mono)}>
                  {String(group.servers.length).padStart(2, '0')}
                </span>
              </div>
              {group.servers.map((server) => {
                const on = current !== 'new' && current?.id === server.id;
                const { label, tone } = statusOf(server);
                return (
                  <button
                    key={server.id}
                    type="button"
                    aria-current={on ? 'true' : undefined}
                    onClick={() => choose(server.id)}
                    {...stylex.props(ui.item, on && ui.itemOn)}
                  >
                    <StatusDot variant={tone} label={label} />
                    <span {...stylex.props(ui.itemName)}>{server.name}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <section {...stylex.props(ui.pane)}>
          {current === 'new' ? (
            <NewServer
              key="new"
              model={model}
              onSaved={(saved) => {
                setPicked(saved.id);
              }}
            />
          ) : editing ? (
            <EditServer
              key={`edit-${current.id}`}
              model={model}
              server={current}
              onDone={() => setEditing(false)}
            />
          ) : (
            <Detail
              key={current.id}
              server={current}
              model={model}
              onEdit={() => setEditing(true)}
              onRemove={() => setRemoving(current)}
            />
          )}
        </section>
      </div>

      {removing !== null && (
        <ConfirmRemove
          server={removing}
          model={model}
          onDone={(removed) => {
            if (removed) setPicked(null);
            setRemoving(null);
          }}
        />
      )}
    </div>
  );
}

function Detail({
  server,
  model,
  onEdit,
  onRemove,
}: {
  server: McpServer;
  model: VariantProps['model'];
  onEdit: () => void;
  onRemove: () => void;
}) {
  const saved = server.hasCredentials || server.credentialsPersisted;

  return (
    <>
      <header {...stylex.props(ui.paneHead)}>
        <div {...stylex.props(ui.title)}>
          <Heading level={3}>{server.name}</Heading>
          <span {...stylex.props(ui.titleMeta)}>
            <Status server={server} />
            <span>·</span>
            <span>{toolsOf(server)}</span>
          </span>
        </div>
        <Switch
          label="Enabled"
          value={server.enabled}
          changeAction={(enabled) => model.setEnabled(server, enabled)}
        />
        <ServerMenu server={server} model={model} onEdit={onEdit} onRemove={onRemove} />
      </header>

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

      <div {...stylex.props(ui.block)}>
        <h4 {...stylex.props(ui.sub)}>Tools</h4>
        <Tools server={server} model={model} />
      </div>

      <div {...stylex.props(ui.block)}>
        <div {...stylex.props(ui.subRow)}>
          <h4 {...stylex.props(ui.sub, ui.subBare)}>How it is reached</h4>
          <Button label="Edit" size="sm" variant="ghost" onClick={onEdit} />
        </div>
        <dl {...stylex.props(ui.facts)}>
          <dt>Kind</dt>
          <dd>{kindOf(server) === 'Local' ? 'A command on this machine' : 'A hosted server'}</dd>
          <dt>{server.transport === 'stdio' ? 'Command' : 'Link'}</dt>
          <dd {...stylex.props(ui.mono)}>{reachOf(server)}</dd>
          {server.transport === 'stdio' && (
            <>
              <dt>Working folder</dt>
              <dd {...stylex.props(ui.mono)}>{server.cwd ?? 'Inherited from the chat'}</dd>
            </>
          )}
          <dt>Available in</dt>
          <dd>{scopeLabel(server, model.workspaces)}</dd>
          <dt>Credentials</dt>
          <dd>
            {server.hasOAuth
              ? 'Signed in'
              : saved
                ? server.credentialsPersisted
                  ? 'Saved, encrypted'
                  : 'Held until the app closes'
                : 'None'}
          </dd>
        </dl>
      </div>
    </>
  );
}

function NewServer({
  model,
  onSaved,
}: {
  model: VariantProps['model'];
  onSaved: (saved: McpServer) => void;
}) {
  const editor = useServerEditor(model, null, onSaved);
  return (
    <>
      <header {...stylex.props(ui.paneHead)}>
        <div {...stylex.props(ui.title)}>
          <Heading level={3}>Add an MCP server</Heading>
        </div>
      </header>
      <McpServerForm form={editor.form} change={editor.change} editing={null} model={model} />
      <Foot editor={editor} model={model} label="Add server" />
    </>
  );
}

function EditServer({
  model,
  server,
  onDone,
}: {
  model: VariantProps['model'];
  server: McpServer;
  onDone: () => void;
}) {
  const editor = useServerEditor(model, server, onDone);
  return (
    <>
      <header {...stylex.props(ui.paneHead)}>
        <div {...stylex.props(ui.title)}>
          <Heading level={3}>{`Edit ${server.name}`}</Heading>
        </div>
      </header>
      <McpServerForm form={editor.form} change={editor.change} editing={server} model={model} />
      <Foot editor={editor} model={model} label="Save server" onCancel={onDone} />
    </>
  );
}

function Foot({
  editor,
  model,
  label,
  onCancel,
}: {
  editor: ReturnType<typeof useServerEditor>;
  model: VariantProps['model'];
  label: string;
  onCancel?: () => void;
}) {
  return (
    <div {...stylex.props(ui.foot)}>
      {model.problem !== null && (
        <Banner status="error" title="Could not save" description={model.problem} />
      )}
      <div {...stylex.props(ui.footRow)}>
        <Text type="supporting" color="secondary">
          {editor.missing ?? ' '}
        </Text>
        <span {...stylex.props(ui.footButtons)}>
          {onCancel && (
            <Button
              label="Cancel"
              size="sm"
              variant="ghost"
              isDisabled={model.busy}
              onClick={onCancel}
            />
          )}
          <Button
            label={model.busy ? 'Saving' : label}
            size="sm"
            variant="primary"
            isDisabled={!editor.ready}
            onClick={() => void editor.save()}
          />
        </span>
      </div>
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
    gridTemplateColumns: '248px minmax(0, 1fr)',
    minHeight: 480,
    borderBlockStartWidth: borderVars['--border-width'],
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: colorVars['--color-border'],
  },
  rail: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-1'],
    paddingBlock: spacingVars['--spacing-3'],
    paddingInlineEnd: spacingVars['--spacing-3'],
    borderInlineEndWidth: borderVars['--border-width'],
    borderInlineEndStyle: 'solid',
    borderInlineEndColor: colorVars['--color-border'],
  },
  group: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    paddingBlockStart: spacingVars['--spacing-3'],
  },
  groupHead: {
    display: 'flex',
    justifyContent: 'space-between',
    paddingInline: spacingVars['--spacing-2'],
    paddingBlockEnd: spacingVars['--spacing-1'],
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
  },
  item: {
    display: 'grid',
    gridTemplateColumns: '16px minmax(0, 1fr)',
    alignItems: 'center',
    columnGap: spacingVars['--spacing-2'],
    height: 36,
    paddingInline: spacingVars['--spacing-2'],
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
  itemOn: { backgroundColor: colorVars['--color-background-muted'], fontWeight: 600 },
  itemName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  pane: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-5'],
    paddingBlock: spacingVars['--spacing-3'],
    paddingInlineStart: spacingVars['--spacing-6'],
    minWidth: 0,
  },
  paneHead: { display: 'flex', alignItems: 'center', gap: spacingVars['--spacing-3'] },
  title: { display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 },
  titleMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
  },
  block: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-3'] },
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
  subBare: { flex: 1, borderBlockEndWidth: 0, paddingBlockEnd: 0 },
  subRow: {
    display: 'flex',
    alignItems: 'center',
    paddingBlockEnd: spacingVars['--spacing-1'],
    borderBlockEndWidth: borderVars['--border-width'],
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-border'],
  },
  facts: {
    display: 'grid',
    gridTemplateColumns: '136px minmax(0, 1fr)',
    rowGap: spacingVars['--spacing-2'],
    columnGap: spacingVars['--spacing-3'],
    margin: 0,
    fontSize: textSizeVars['--font-size-base'],
  },
  foot: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-3'] },
  footRow: { display: 'flex', alignItems: 'center', gap: spacingVars['--spacing-3'] },
  footButtons: { display: 'flex', gap: spacingVars['--spacing-2'], marginInlineStart: 'auto' },
  mono: {
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-sm'],
  },
  dim: {
    margin: 0,
    paddingInline: spacingVars['--spacing-2'],
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
  },
});
