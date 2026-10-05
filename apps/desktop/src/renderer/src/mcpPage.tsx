/**
 * A server's page, opened from its tile (or Add): its name and status, whether it is on, and its
 * menu, then three tabs that split what a person comes for. Overview says whether it is working
 * and how it is reached; Tools says which of them Kira may call; Settings is the form. Edits made
 * in Settings survive a trip to another tab. Add has no tabs, only the form.
 */
import { Button } from '@astryxdesign/core/Button';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import {
  borderVars,
  colorVars,
  spacingVars,
  textSizeVars,
  typographyVars,
} from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import type { McpServer } from '../../preload/bridge';
import { McpServerForm, SaveRow, useServerEditor } from './mcpForm';
import { kindOf, reachOf, scopeLabel } from './mcpModel';
import { Notices, ServerHead, Tools, type PageProps } from './mcpParts';

export function McpPage({ model, server, onBack, onSaved, onRemove }: PageProps) {
  const editor = useServerEditor(model, server, onSaved);
  const [tab, setTab] = useState('overview');

  return (
    <div {...stylex.props(ui.page)}>
      <ServerHead server={server} model={model} onBack={onBack} onRemove={onRemove} />
      {server === null ? (
        <>
          <McpServerForm form={editor.form} change={editor.change} editing={null} model={model} />
          <SaveRow
            editor={editor}
            model={model}
            label="Create"
            cancelLabel="Cancel"
            onCancel={onBack}
          />
        </>
      ) : (
        <>
          <Notices server={server} model={model} />
          <TabList value={tab} onChange={setTab} size="sm" hasDivider>
            <Tab value="overview" label="Overview" />
            <Tab value="tools" label={`Tools · ${server.tools.length}`} />
            <Tab value="settings" label={editor.dirty ? 'Settings · edited' : 'Settings'} />
          </TabList>
          {tab === 'overview' ? (
            <Overview server={server} model={model} />
          ) : tab === 'tools' ? (
            <Tools server={server} model={model} />
          ) : (
            <>
              <McpServerForm
                form={editor.form}
                change={editor.change}
                editing={server}
                model={model}
              />
              <SaveRow editor={editor} model={model} label="Save changes" />
            </>
          )}
        </>
      )}
    </div>
  );
}

function Overview({ server, model }: { server: McpServer; model: PageProps['model'] }) {
  const saved = server.hasCredentials || server.credentialsPersisted;
  const canSignIn =
    server.transport === 'streamable-http' &&
    server.enabled &&
    (!server.hasOAuth || server.status === 'needs-sign-in');

  return (
    <div {...stylex.props(ui.overview)}>
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
      <div {...stylex.props(ui.actions)}>
        {server.enabled && (
          <Button
            label={server.status === 'connected' ? 'Reconnect' : 'Connect'}
            size="sm"
            variant="secondary"
            isDisabled={model.busy}
            onClick={() => void model.reconnect(server)}
          />
        )}
        {canSignIn && (
          <Button
            label="Sign in"
            size="sm"
            variant="secondary"
            isDisabled={model.busy}
            onClick={() => void model.signIn(server)}
          />
        )}
        {(server.hasOAuth || server.oauthCredentialsPersisted) && (
          <Button
            label="Sign out"
            size="sm"
            variant="ghost"
            isDisabled={model.busy}
            onClick={() => void model.signOut(server)}
          />
        )}
      </div>
    </div>
  );
}

const ui = stylex.create({
  page: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-5'] },
  overview: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-5'] },
  facts: {
    display: 'grid',
    gridTemplateColumns: '136px minmax(0, 1fr)',
    rowGap: spacingVars['--spacing-3'],
    columnGap: spacingVars['--spacing-3'],
    margin: 0,
    paddingBlock: spacingVars['--spacing-2'],
    borderBlockStartWidth: borderVars['--border-width'],
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: colorVars['--color-border'],
    fontSize: textSizeVars['--font-size-base'],
  },
  actions: { display: 'flex', gap: spacingVars['--spacing-2'] },
  mono: {
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-sm'],
    overflowWrap: 'anywhere',
  },
});
