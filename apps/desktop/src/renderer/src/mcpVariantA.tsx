/**
 * PROTOTYPE — MCP servers, variant A: the ledger, with the editor in a dialog.
 *
 * Drawn like the Git hosts page: servers are ruled rows on one grid, grouped by where they are
 * offered, with their status in words and the on/off switch on the row. A row opens in place
 * to show its tools and what went wrong. Adding and editing share one dialog.
 */
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Dialog } from '@astryxdesign/core/Dialog';
import { Heading } from '@astryxdesign/core/Heading';
import { Icon } from '@astryxdesign/core/Icon';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import {
  borderVars,
  colorVars,
  focusVars,
  spacingVars,
  textSizeVars,
  typographyVars,
} from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronRight, Globe, Plus, Search, Terminal } from 'lucide-react';
import { useState } from 'react';
import type { McpServer } from '../../preload/bridge';
import { FlushDialogHeader } from './dialogHeader';
import { ConfirmRemove, McpServerForm, useServerEditor } from './mcpForm';
import { groupByScope, kindOf, matches, reachOf, toolsOf } from './mcpModel';
import { ServerMenu, Status, Tools } from './mcpParts';
import type { VariantProps } from './mcpSection';

export function McpVariantA({ model, onModal }: VariantProps) {
  const { servers, problem } = model;
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<McpServer | 'new' | null>(null);
  const [removing, setRemoving] = useState<McpServer | null>(null);

  const shown = (servers ?? []).filter((each) => matches(each, query));
  const groups = groupByScope(shown, model.workspaces);
  const none = servers !== null && servers.length === 0;

  const edit = (next: McpServer | 'new' | null): void => {
    setEditing(next);
    onModal(next !== null);
    if (next === null) model.clearProblem();
  };

  return (
    <div {...stylex.props(ui.page)}>
      <header {...stylex.props(ui.header)}>
        <div {...stylex.props(ui.intro)}>
          <Heading level={2}>MCP servers</Heading>
          <Text color="secondary" size="sm">
            Give Kira tools from Model Context Protocol servers. A server is offered in every chat,
            or only in the chats of one workspace.
          </Text>
        </div>
        <Button
          label="Add a server"
          size="sm"
          variant="primary"
          icon={<Icon icon={Plus} size="sm" />}
          onClick={() => edit('new')}
        />
      </header>

      {problem !== null && editing === null && (
        <Banner status="error" title="MCP servers" description={problem} />
      )}

      {servers !== null && servers.length > 3 && (
        <div {...stylex.props(ui.search)}>
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
        </div>
      )}

      {servers === null ? (
        <div aria-busy="true" {...stylex.props(ui.waiting)}>
          <Skeleton width="40%" height={16} />
          <Skeleton width="65%" height={16} index={1} />
        </div>
      ) : none ? (
        <p {...stylex.props(ui.none)}>
          No MCP servers yet. Add one with a command that starts it on this machine, or the link to
          a hosted server.
        </p>
      ) : groups.every((group) => group.servers.length === 0) ? (
        <p {...stylex.props(ui.none)}>{`No server matches “${query}”.`}</p>
      ) : (
        groups
          .filter((group) => group.servers.length > 0 || query === '')
          .map((group) => (
            <section key={group.id} aria-label={group.label}>
              <div {...stylex.props(ui.sectionHead)}>
                <Heading level={3}>{group.label}</Heading>
                <span {...stylex.props(ui.count)}>
                  {String(group.servers.length).padStart(2, '0')}
                </span>
              </div>
              {group.servers.length === 0 ? (
                <p {...stylex.props(ui.none)}>Nothing here is offered in every chat.</p>
              ) : (
                <ul {...stylex.props(ui.ledger)}>
                  {group.servers.map((server) => (
                    <Row
                      key={server.id}
                      server={server}
                      model={model}
                      onEdit={() => edit(server)}
                      onRemove={() => setRemoving(server)}
                    />
                  ))}
                </ul>
              )}
            </section>
          ))
      )}

      {editing !== null && <Editor model={model} editing={editing} onClose={() => edit(null)} />}
      {removing !== null && (
        <ConfirmRemove server={removing} model={model} onDone={() => setRemoving(null)} />
      )}
    </div>
  );
}

function Row({
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
  const [open, setOpen] = useState(false);

  return (
    <li {...stylex.props(ui.row)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        {...stylex.props(ui.name)}
      >
        <Icon
          icon={ChevronRight}
          size="sm"
          color="secondary"
          xstyle={[ui.chevron, open && ui.chevronOpen]}
        />
        <Icon icon={server.transport === 'stdio' ? Terminal : Globe} size="sm" color="secondary" />
        <span {...stylex.props(ui.who)}>
          <Text type="label" weight="medium" maxLines={1}>
            {server.name}
          </Text>
          <span {...stylex.props(ui.mono, ui.dim, ui.clip)} title={reachOf(server)}>
            {reachOf(server)}
          </span>
        </span>
      </button>
      <span {...stylex.props(ui.kind)}>{kindOf(server)}</span>
      <span {...stylex.props(ui.state)}>
        <Status server={server} />
      </span>
      <span {...stylex.props(ui.tools)}>{toolsOf(server)}</span>
      <span {...stylex.props(ui.toggle)}>
        <Switch
          label={`${server.name} enabled`}
          isLabelHidden
          value={server.enabled}
          changeAction={(enabled) => model.setEnabled(server, enabled)}
        />
      </span>
      <span {...stylex.props(ui.menu)}>
        <ServerMenu server={server} model={model} onEdit={onEdit} onRemove={onRemove} />
      </span>
      {open && (
        <div {...stylex.props(ui.detail)}>
          {server.status === 'failed' && server.error !== null && (
            <Banner status="error" title="The server did not start" description={server.error} />
          )}
          {server.status === 'needs-sign-in' && (
            <Banner status="warning" title="This server needs you to sign in" />
          )}
          <Tools server={server} model={model} />
        </div>
      )}
    </li>
  );
}

function Editor({
  model,
  editing,
  onClose,
}: {
  model: VariantProps['model'];
  editing: McpServer | 'new';
  onClose: () => void;
}) {
  const existing = editing === 'new' ? null : editing;
  const editor = useServerEditor(model, existing, onClose);

  return (
    <Dialog
      isOpen
      onOpenChange={(open) => !open && !model.busy && onClose()}
      purpose="form"
      width={640}
    >
      <FlushDialogHeader
        title={existing === null ? 'Add an MCP server' : `Edit ${existing.name}`}
        onOpenChange={(open) => !open && !model.busy && onClose()}
      />
      <div {...stylex.props(ui.dialogBody)}>
        <McpServerForm form={editor.form} change={editor.change} editing={existing} model={model} />
        {model.problem !== null && (
          <Banner status="error" title="Could not save" description={model.problem} />
        )}
      </div>
      <div {...stylex.props(ui.foot)}>
        <Text type="supporting" color="secondary">
          {editor.missing ?? ' '}
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
            label={model.busy ? 'Saving' : existing === null ? 'Add server' : 'Save server'}
            size="sm"
            variant="primary"
            isDisabled={!editor.ready}
            onClick={() => void editor.save()}
          />
        </span>
      </div>
    </Dialog>
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
  search: { maxWidth: 320 },
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
  waiting: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-2'] },
  none: {
    margin: 0,
    paddingBlock: spacingVars['--spacing-2'],
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
    maxWidth: '60ch',
  },
  ledger: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 56px 128px 64px 44px 32px',
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
    minHeight: 56,
    borderBlockEndWidth: borderVars['--border-width'],
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-border'],
  },
  name: {
    gridColumn: 1,
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    minWidth: 0,
    minHeight: 56,
    padding: 0,
    border: 0,
    background: 'transparent',
    color: colorVars['--color-text-primary'],
    font: 'inherit',
    textAlign: 'start',
    cursor: 'pointer',
    outlineStyle: { default: 'none', ':focus-visible': focusVars['--focus-outline-style'] },
    outlineWidth: focusVars['--focus-outline-width'],
    outlineColor: focusVars['--focus-outline-color'],
  },
  chevron: { transitionProperty: 'transform', transitionDuration: '120ms' },
  chevronOpen: { transform: 'rotate(90deg)' },
  who: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
  kind: {
    gridColumn: 2,
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
  },
  state: { gridColumn: 3 },
  tools: {
    gridColumn: 4,
    textAlign: 'end',
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
  toggle: { gridColumn: 5, display: 'flex', justifyContent: 'center' },
  menu: { gridColumn: 6, display: 'flex', justifyContent: 'flex-end' },
  detail: {
    gridColumn: '1 / -1',
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-3'],
    paddingBlockStart: spacingVars['--spacing-1'],
    paddingBlockEnd: spacingVars['--spacing-4'],
    paddingInlineStart: spacingVars['--spacing-8'],
  },
  mono: {
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-sm'],
  },
  dim: { color: colorVars['--color-text-secondary'] },
  clip: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  dialogBody: {
    maxHeight: '64vh',
    overflowY: 'auto',
    paddingInlineEnd: spacingVars['--spacing-1'],
  },
  foot: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingVars['--spacing-3'],
    paddingBlockStart: spacingVars['--spacing-4'],
  },
  footButtons: { display: 'flex', gap: spacingVars['--spacing-2'], marginInlineStart: 'auto' },
});
