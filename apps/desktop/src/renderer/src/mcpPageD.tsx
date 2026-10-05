/**
 * PROTOTYPE — a server's page, variant D: read first, edit a section at a time.
 *
 * The page is a ledger of what the server is: tools you can switch live, then its name and
 * scope, how it is reached, what it is given, and where it runs — each a line you read, with
 * Edit opening only that section in place and Save and Cancel beside its fields. One section
 * is open at a time. Add shows the whole form, since there is nothing yet to read.
 */
import { Button } from '@astryxdesign/core/Button';
import { Text } from '@astryxdesign/core/Text';
import {
  borderVars,
  colorVars,
  spacingVars,
  textSizeVars,
  typographyVars,
} from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { useState, type ReactNode } from 'react';
import {
  AdvancedFields,
  McpServerForm,
  ReachFields,
  SaveRow,
  SecretsFields,
  ServerFields,
  sectionText,
  useServerEditor,
} from './mcpForm';
import { kindOf, reachOf, scopeLabel } from './mcpModel';
import { Notices, ServerHead, Tools, type PageProps } from './mcpParts';

type PartName = 'server' | 'reach' | 'secrets' | 'advanced';

export function McpPageD({ model, server, onBack, onSaved, onRemove }: PageProps) {
  const [open, setOpen] = useState<PartName | null>(null);
  const editor = useServerEditor(model, server, (saved) => {
    setOpen(null);
    onSaved(saved);
  });

  if (server === null) {
    return (
      <div {...stylex.props(ui.page)}>
        <ServerHead server={null} model={model} onBack={onBack} onRemove={onRemove} />
        <McpServerForm form={editor.form} change={editor.change} editing={null} model={model} />
        <SaveRow
          editor={editor}
          model={model}
          label="Create"
          cancelLabel="Cancel"
          onCancel={onBack}
        />
      </div>
    );
  }

  const remote = server.transport === 'streamable-http';
  const text = sectionText(remote);
  const fields = { form: editor.form, change: editor.change, editing: server, model };
  const saved = server.hasCredentials || server.credentialsPersisted;

  const part = (
    name: PartName,
    title: string,
    hint: string | null,
    reading: ReactNode,
    editing: ReactNode,
  ): ReactNode => (
    <Part
      key={name}
      title={title}
      hint={open === name ? hint : null}
      isOpen={open === name}
      canEdit={open === null}
      onEdit={() => setOpen(name)}
      footer={
        <SaveRow
          editor={editor}
          model={model}
          label="Save"
          onCancel={() => {
            editor.reset();
            setOpen(null);
          }}
        />
      }
      editing={editing}
    >
      {reading}
    </Part>
  );

  return (
    <div {...stylex.props(ui.page)}>
      <ServerHead server={server} model={model} onBack={onBack} onRemove={onRemove} />
      <Notices server={server} model={model} />

      <section {...stylex.props(ui.part)}>
        <div {...stylex.props(ui.partHead)}>
          <Text type="label" weight="medium">
            {`Tools · ${server.tools.length}`}
          </Text>
        </div>
        <Tools server={server} model={model} />
      </section>

      {part(
        'server',
        text.server.title,
        text.server.hint,
        <Line>
          {server.name} · {scopeLabel(server, model.workspaces)}
        </Line>,
        <ServerFields {...fields} />,
      )}
      {part(
        'reach',
        text.reach.title,
        text.reach.hint,
        <>
          <Line>
            {kindOf(server) === 'Local' ? 'A command on this machine' : 'A hosted server'}
          </Line>
          <Line mono>{reachOf(server)}</Line>
        </>,
        <ReachFields {...fields} />,
      )}
      {part(
        'secrets',
        text.secrets.title,
        text.secrets.hint,
        <Line>
          {server.hasOAuth
            ? 'Signed in'
            : saved
              ? server.credentialsPersisted
                ? 'Saved, encrypted. Values are never shown.'
                : 'Held until the app closes. Values are never shown.'
              : 'None'}
        </Line>,
        <SecretsFields {...fields} />,
      )}
      {!remote &&
        part(
          'advanced',
          text.advanced.title,
          text.advanced.hint,
          <Line mono={server.cwd !== null}>{server.cwd ?? 'Runs in the chat’s folder'}</Line>,
          <AdvancedFields {...fields} />,
        )}
    </div>
  );
}

function Line({ children, mono = false }: { children: ReactNode; mono?: boolean }) {
  return <span {...stylex.props(ui.line, mono && ui.mono)}>{children}</span>;
}

function Part({
  title,
  hint,
  isOpen,
  canEdit,
  onEdit,
  footer,
  editing,
  children,
}: {
  title: string;
  hint: string | null;
  isOpen: boolean;
  canEdit: boolean;
  onEdit: () => void;
  footer: ReactNode;
  editing: ReactNode;
  children: ReactNode;
}) {
  return (
    <section {...stylex.props(ui.part)}>
      <div {...stylex.props(ui.partHead)}>
        <div {...stylex.props(ui.partTitle)}>
          <Text type="label" weight="medium">
            {title}
          </Text>
          {hint !== null && (
            <Text type="supporting" color="secondary">
              {hint}
            </Text>
          )}
        </div>
        {!isOpen && (
          <Button label="Edit" size="sm" variant="ghost" isDisabled={!canEdit} onClick={onEdit} />
        )}
      </div>
      {isOpen ? (
        <>
          {editing}
          {footer}
        </>
      ) : (
        <div {...stylex.props(ui.reading)}>{children}</div>
      )}
    </section>
  );
}

const ui = stylex.create({
  page: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-5'] },
  part: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-3'],
    paddingBlock: spacingVars['--spacing-4'],
    borderBlockStartWidth: borderVars['--border-width'],
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: colorVars['--color-border'],
  },
  partHead: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-3'],
    minHeight: 28,
  },
  partTitle: { display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 },
  reading: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-1'] },
  line: { fontSize: textSizeVars['--font-size-base'], overflowWrap: 'anywhere' },
  mono: {
    fontFamily: typographyVars['--font-family-code'],
    fontSize: textSizeVars['--font-size-sm'],
    color: colorVars['--color-text-secondary'],
  },
});
