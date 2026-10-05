/**
 * PROTOTYPE — a server's page, variant A: one page, top to bottom.
 *
 * Status first, then the tools, then the form's four sections, with one Save at the foot. The
 * simplest reading: nothing is hidden, and the page is as long as the server is complicated.
 */
import { Text } from '@astryxdesign/core/Text';
import { spacingVars } from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { McpServerForm, SaveRow, useServerEditor } from './mcpForm';
import { Notices, ServerHead, Tools, type PageProps } from './mcpParts';

export function McpPageA({ model, server, onBack, onSaved, onRemove }: PageProps) {
  const editor = useServerEditor(model, server, onSaved);

  return (
    <div {...stylex.props(ui.page)}>
      <ServerHead server={server} model={model} onBack={onBack} onRemove={onRemove} />
      {server !== null && <Notices server={server} model={model} />}
      {server !== null && (
        <section {...stylex.props(ui.tools)}>
          <Text type="label" weight="medium">
            Tools
          </Text>
          <Tools server={server} model={model} />
        </section>
      )}
      <McpServerForm form={editor.form} change={editor.change} editing={server} model={model} />
      <SaveRow
        editor={editor}
        model={model}
        label={server === null ? 'Create' : 'Save changes'}
        cancelLabel={server === null ? 'Cancel' : 'Back'}
        onCancel={onBack}
      />
    </div>
  );
}

const ui = stylex.create({
  page: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-5'] },
  tools: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-3'] },
});
