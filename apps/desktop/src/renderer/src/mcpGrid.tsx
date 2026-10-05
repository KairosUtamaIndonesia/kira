/**
 * PROTOTYPE — the MCP servers page: a grid of tiles, one per server, with an Add tile first.
 *
 * Each tile carries the server's status chip, how it is reached and how many tools it offers;
 * search and a where-it-is-offered filter narrow the grid. A tile asks to be opened (`onOpen`),
 * and the page it opens is the next screen's business. Wipe the PROTOTYPE marks when this folds in.
 */
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Heading } from '@astryxdesign/core/Heading';
import { Icon } from '@astryxdesign/core/Icon';
import { Selector } from '@astryxdesign/core/Selector';
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
import { Globe, Plus, Search, Terminal } from 'lucide-react';
import { useState } from 'react';
import { kindOf, matches, reachOf, statusOf, toolsOf, type McpModel } from './mcpModel';
import { BADGE } from './mcpParts';

export function McpGrid({
  model,
  onOpen,
}: {
  model: McpModel;
  /** A server's id, or 'new' for the Add tile. */
  onOpen: (id: string) => void;
}) {
  const { servers, problem } = model;
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('all');

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
        <button type="button" onClick={() => onOpen('new')} {...stylex.props(ui.tile, ui.add)}>
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
              onClick={() => onOpen(server.id)}
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
});
