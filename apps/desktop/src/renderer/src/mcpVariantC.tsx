/**
 * PROTOTYPE — MCP servers, variant C: tiles, and a page for each server.
 *
 * Closest to OpenChamber's: a grid of tiles with a status chip on each and an Add tile first,
 * searchable and filtered by where a server is offered. A tile opens a page of its own — status
 * and switch, tools, then the form's sections — with a way back; Add opens the same page blank.
 */
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Selector } from '@astryxdesign/core/Selector';
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
import { ArrowLeft, Globe, Plus, Search, Terminal } from 'lucide-react';
import { useState } from 'react';
import type { McpServer } from '../../preload/bridge';
import { ConfirmRemove, McpServerForm, useServerEditor } from './mcpForm';
import { formOf, kindOf, matches, reachOf, statusOf, toolsOf, type Tone } from './mcpModel';
import { ServerMenu, Tools } from './mcpParts';
import type { VariantProps } from './mcpSection';

const BADGE: Record<Tone, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  success: 'success',
  warning: 'warning',
  error: 'error',
  accent: 'info',
  neutral: 'neutral',
};

export function McpVariantC({ model }: VariantProps) {
  const { servers, problem } = model;
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('all');
  const [page, setPage] = useState<string | null>(null);
  const [removing, setRemoving] = useState<McpServer | null>(null);

  const open = page === 'new' ? 'new' : (servers?.find((each) => each.id === page) ?? null);
  const back = (): void => {
    setPage(null);
    model.clearProblem();
  };

  if (open !== null) {
    return (
      <>
        {open === 'new' ? (
          <ServerPage
            key="new"
            model={model}
            server={null}
            onBack={back}
            onSaved={(s) => setPage(s.id)}
          />
        ) : (
          <ServerPage
            key={open.id}
            model={model}
            server={open}
            onBack={back}
            onSaved={() => undefined}
            onRemove={() => setRemoving(open)}
          />
        )}
        {removing !== null && (
          <ConfirmRemove
            server={removing}
            model={model}
            onDone={(removed) => {
              setRemoving(null);
              if (removed) back();
            }}
          />
        )}
      </>
    );
  }

  const shown = (servers ?? []).filter(
    (each) =>
      matches(each, query) &&
      (scope === 'all' ||
        (scope === 'global' ? each.scope === 'global' : each.workspaceId === scope)),
  );

  return (
    <div {...stylex.props(ui.page)}>
      <header {...stylex.props(ui.header)}>
        <div {...stylex.props(ui.intro)}>
          <Heading level={2}>MCP servers</Heading>
          <Text color="secondary" size="sm">
            Tool servers your agents can call. Open one to see its status and settings.
          </Text>
        </div>
        <div {...stylex.props(ui.scope)}>
          <Selector
            label="Show servers"
            isLabelHidden
            size="sm"
            options={[
              { value: 'all', label: 'Everywhere' },
              { value: 'global', label: 'Every chat' },
              ...model.workspaces.map((workspace) => ({
                value: workspace.id,
                label: `Only in ${workspace.name}`,
              })),
            ]}
            value={scope}
            onChange={(next) => setScope(next ?? 'all')}
          />
        </div>
      </header>

      {problem !== null && <Banner status="error" title="MCP servers" description={problem} />}

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

      <div {...stylex.props(ui.grid)}>
        <button type="button" onClick={() => setPage('new')} {...stylex.props(ui.tile, ui.add)}>
          <span {...stylex.props(ui.plus)}>
            <Icon icon={Plus} size="md" />
          </span>
          <Text type="label" weight="medium">
            Add MCP server
          </Text>
          <Text type="supporting" color="secondary">
            Local command or remote link
          </Text>
        </button>
        {shown.map((server) => {
          const { label, tone } = statusOf(server);
          return (
            <button
              key={server.id}
              type="button"
              onClick={() => setPage(server.id)}
              {...stylex.props(ui.tile)}
            >
              <span {...stylex.props(ui.tileTop)}>
                <span {...stylex.props(ui.glyph)}>
                  <Icon icon={server.transport === 'stdio' ? Terminal : Globe} size="sm" />
                </span>
                <Badge label={label} variant={BADGE[tone]} />
              </span>
              <Text type="label" weight="medium" maxLines={1}>
                {server.name}
              </Text>
              <span {...stylex.props(ui.mono, ui.clip)} title={reachOf(server)}>
                {reachOf(server)}
              </span>
              <span {...stylex.props(ui.meta)}>
                {kindOf(server)} server · {toolsOf(server)}
              </span>
            </button>
          );
        })}
      </div>
      {servers !== null && shown.length === 0 && servers.length > 0 && (
        <Text type="supporting" color="secondary">
          No server matches.
        </Text>
      )}
    </div>
  );
}

function ServerPage({
  model,
  server,
  onBack,
  onSaved,
  onRemove,
}: {
  model: VariantProps['model'];
  server: McpServer | null;
  onBack: () => void;
  onSaved: (saved: McpServer) => void;
  onRemove?: () => void;
}) {
  const editor = useServerEditor(model, server, onSaved);
  const dirty = server === null || JSON.stringify(editor.form) !== JSON.stringify(formOf(server));
  const status = server === null ? null : statusOf(server);

  return (
    <div {...stylex.props(ui.page)}>
      <header {...stylex.props(ui.pageHead)}>
        <IconButton
          label="Back to servers"
          icon={<Icon icon={ArrowLeft} size="sm" />}
          size="sm"
          variant="ghost"
          onClick={onBack}
        />
        <div {...stylex.props(ui.intro)}>
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
            <ServerMenu
              server={server}
              model={model}
              onEdit={() => undefined}
              onRemove={onRemove ?? (() => undefined)}
            />
          </>
        )}
      </header>

      {server !== null && server.status === 'failed' && server.error !== null && (
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
      {server !== null && server.status === 'needs-sign-in' && (
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

      {server !== null && (
        <section {...stylex.props(ui.tools)}>
          <Text type="label" weight="medium">
            Tools
          </Text>
          <Tools server={server} model={model} />
        </section>
      )}

      <McpServerForm form={editor.form} change={editor.change} editing={server} model={model} />

      {model.problem !== null && (
        <Banner status="error" title="Could not save" description={model.problem} />
      )}
      <div {...stylex.props(ui.foot)}>
        <Button
          label={model.busy ? 'Saving' : server === null ? 'Create' : 'Save changes'}
          size="sm"
          variant="primary"
          isDisabled={!editor.ready || !dirty}
          onClick={() => void editor.save()}
        />
        <Button
          label={server === null ? 'Cancel' : 'Back'}
          size="sm"
          variant="ghost"
          onClick={onBack}
        />
        <Text type="supporting" color="secondary">
          {dirty ? (editor.missing ?? ' ') : ' '}
        </Text>
      </div>
    </div>
  );
}

const ui = stylex.create({
  page: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-5'] },
  header: { display: 'flex', alignItems: 'flex-start', gap: spacingVars['--spacing-4'] },
  intro: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-1'],
    flex: 1,
    minWidth: 0,
  },
  scope: { width: 220 },
  search: { maxWidth: 360 },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: spacingVars['--spacing-3'],
  },
  tile: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: spacingVars['--spacing-1'],
    minHeight: 148,
    padding: spacingVars['--spacing-4'],
    borderWidth: borderVars['--border-width'],
    borderStyle: 'solid',
    borderColor: {
      default: colorVars['--color-border'],
      ':hover': colorVars['--color-border-emphasized'],
    },
    borderRadius: radiusVars['--radius-container'],
    backgroundColor: colorVars['--color-background-surface'],
    color: colorVars['--color-text-primary'],
    font: 'inherit',
    textAlign: 'start',
    cursor: 'pointer',
    outlineStyle: { default: 'none', ':focus-visible': focusVars['--focus-outline-style'] },
    outlineWidth: focusVars['--focus-outline-width'],
    outlineColor: focusVars['--focus-outline-color'],
    outlineOffset: 2,
  },
  add: {
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    borderStyle: 'dashed',
    backgroundColor: 'transparent',
  },
  plus: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
    marginBlockEnd: spacingVars['--spacing-2'],
    borderRadius: radiusVars['--radius-element'],
    backgroundColor: colorVars['--color-background-muted'],
  },
  tileTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    marginBlockEnd: spacingVars['--spacing-2'],
  },
  glyph: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    borderRadius: radiusVars['--radius-element'],
    backgroundColor: colorVars['--color-background-muted'],
    color: colorVars['--color-text-secondary'],
  },
  meta: {
    marginBlockStart: 'auto',
    paddingBlockStart: spacingVars['--spacing-2'],
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
  },
  mono: {
    alignSelf: 'stretch',
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
  },
  clip: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  pageHead: { display: 'flex', alignItems: 'center', gap: spacingVars['--spacing-3'] },
  titleRow: { display: 'flex', alignItems: 'center', gap: spacingVars['--spacing-3'] },
  tools: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-3'] },
  foot: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
    paddingBlockStart: spacingVars['--spacing-2'],
  },
});
