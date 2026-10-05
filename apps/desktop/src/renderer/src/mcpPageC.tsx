/**
 * PROTOTYPE — a server's page, variant C: the form, with the server beside it.
 *
 * The form is the page, and Save stays at the foot of it while you scroll. Beside it, a panel
 * that does not scroll away holds the server as it is now: its status and ways to reconnect,
 * its tools, and Remove. Add has no panel, only the form.
 */
import { Button } from '@astryxdesign/core/Button';
import { Text } from '@astryxdesign/core/Text';
import { borderVars, colorVars, spacingVars } from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { McpServerForm, SaveRow, useServerEditor } from './mcpForm';
import { Notices, ServerHead, Status, Tools, type PageProps } from './mcpParts';

export function McpPageC({ model, server, onBack, onSaved, onRemove }: PageProps) {
  const editor = useServerEditor(model, server, onSaved);
  const canSignIn =
    server !== null &&
    server.transport === 'streamable-http' &&
    server.enabled &&
    (!server.hasOAuth || server.status === 'needs-sign-in');

  return (
    <div {...stylex.props(ui.page)}>
      <ServerHead server={server} model={model} onBack={onBack} onRemove={onRemove} />
      {server !== null && <Notices server={server} model={model} />}
      <div {...stylex.props(ui.split, server === null && ui.single)}>
        <div {...stylex.props(ui.main)}>
          <McpServerForm form={editor.form} change={editor.change} editing={server} model={model} />
          <div {...stylex.props(ui.bar)}>
            <SaveRow
              editor={editor}
              model={model}
              label={server === null ? 'Create' : 'Save changes'}
              cancelLabel={server === null ? 'Cancel' : undefined}
              onCancel={server === null ? onBack : undefined}
            />
          </div>
        </div>
        {server !== null && (
          <aside aria-label="Server status" {...stylex.props(ui.aside)}>
            <div {...stylex.props(ui.block)}>
              <Text type="label" weight="medium">
                Status
              </Text>
              <Status server={server} />
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
            <div {...stylex.props(ui.block)}>
              <Text type="label" weight="medium">
                {`Tools · ${server.tools.length}`}
              </Text>
              <Tools server={server} model={model} />
            </div>
            <div>
              <Button label="Remove server…" size="sm" variant="ghost" onClick={onRemove} />
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

const ui = stylex.create({
  page: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-5'] },
  split: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 296px',
    columnGap: spacingVars['--spacing-6'],
    alignItems: 'start',
  },
  single: { gridTemplateColumns: 'minmax(0, 640px)' },
  main: { display: 'flex', flexDirection: 'column', minWidth: 0 },
  bar: {
    position: 'sticky',
    insetBlockEnd: 0,
    paddingBlock: spacingVars['--spacing-3'],
    backgroundColor: colorVars['--color-background-surface'],
    borderBlockStartWidth: borderVars['--border-width'],
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: colorVars['--color-border'],
  },
  aside: {
    position: 'sticky',
    insetBlockStart: spacingVars['--spacing-4'],
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-5'],
    paddingInlineStart: spacingVars['--spacing-5'],
    borderInlineStartWidth: borderVars['--border-width'],
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: colorVars['--color-border'],
  },
  block: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-3'] },
  actions: { display: 'flex', flexWrap: 'wrap', gap: spacingVars['--spacing-2'] },
});
