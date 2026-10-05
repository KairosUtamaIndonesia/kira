/**
 * PROTOTYPE — the add/edit form for an MCP server, in the sections the page's variants share:
 * what it is called and where it is offered, how it is reached, what it is given, and the
 * rarely-wanted rest. Each variant decides only where the form sits (a dialog, a pane, a page).
 * Wipe me with them, or fold me in with the winner.
 *
 * Credentials are write-only: the main process never sends an environment variable or a token
 * back, so on an edit these start empty, and adding any replaces the whole saved set.
 */
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import {
  borderVars,
  colorVars,
  spacingVars,
  textSizeVars,
} from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { Globe, Plus, Terminal, X } from 'lucide-react';
import { useState } from 'react';
import type { McpServer } from '../../preload/bridge';
import {
  blankForm,
  buildDraft,
  formOf,
  parseSnippet,
  type FormValues,
  type McpModel,
  type Pair,
} from './mcpModel';

/** The form's state and the one thing it ends in: a save the main process may refuse. */
export function useServerEditor(
  model: McpModel,
  editing: McpServer | null,
  onSaved: (saved: McpServer) => void,
  scope = 'global',
) {
  const [form, setForm] = useState<FormValues>(() =>
    editing === null ? blankForm(scope) : formOf(editing),
  );
  const built = buildDraft(form);
  const ready = 'draft' in built && !model.busy;

  async function save(): Promise<void> {
    if (!('draft' in built) || model.busy) return;
    const saved = await model.save(editing?.id ?? null, built.draft);
    if (saved === null) return;
    // Credentials never come back, so what was typed is dropped once it is saved.
    setForm(formOf(saved));
    onSaved(saved);
  }

  return {
    form,
    /** Whether the form differs from the server as it is saved (always, for a new one). */
    dirty: editing === null || JSON.stringify(form) !== JSON.stringify(formOf(editing)),
    change: (next: Partial<FormValues>) => setForm((current) => ({ ...current, ...next })),
    /** Put the form back as the saved server has it. */
    reset: () => setForm(editing === null ? blankForm(scope) : formOf(editing)),
    ready,
    /** Why saving is not yet possible, for a person who has not done anything wrong yet. */
    missing: 'error' in built ? built.error : null,
    save,
  };
}

interface FieldsProps {
  form: FormValues;
  change: (next: Partial<FormValues>) => void;
  editing: McpServer | null;
  model: McpModel;
}

/** The words over each part of the form, so a page that lays them out its own way says the same. */
export function sectionText(remote: boolean) {
  return {
    server: { title: 'Server', hint: null },
    reach: {
      title: 'How to reach it',
      hint: 'Paste the command that starts it, or the link to a hosted server.',
    },
    secrets: {
      title: remote ? 'Headers and token' : 'Environment variables',
      hint: remote
        ? 'What the server needs to let Kira in, such as an API key.'
        : 'Values the server needs, such as an API key.',
    },
    advanced: { title: 'Advanced', hint: 'Where the command runs.' },
  };
}

/** Name, where it is offered, and a way to fill the whole form from a README's JSON. */
export function ServerFields({ form, change, model }: FieldsProps) {
  const [snippet, setSnippet] = useState<string | null>(null);
  const [snippetError, setSnippetError] = useState<string | null>(null);

  function importSnippet(): void {
    const found = parseSnippet(snippet ?? '');
    if ('error' in found) {
      setSnippetError(found.error);
      return;
    }
    change({ ...found, clearCredentials: false });
    setSnippet(null);
    setSnippetError(null);
  }

  return (
    <>
      <div {...stylex.props(ui.pair)}>
        <TextInput
          label="Name"
          value={form.name}
          placeholder="postgres"
          size="sm"
          onChange={(name) => change({ name })}
        />
        <Selector
          label="Available in"
          options={[
            { value: 'global', label: 'Every chat' },
            ...model.workspaces.map((workspace) => ({
              value: workspace.id,
              label: `Only in ${workspace.name}`,
            })),
          ]}
          value={form.scope}
          onChange={(scope) => change({ scope: scope ?? 'global' })}
        />
      </div>
      <div {...stylex.props(ui.snippetRow)}>
        <Button
          label={snippet === null ? 'Import a JSON snippet' : 'Cancel import'}
          size="sm"
          variant="ghost"
          onClick={() => {
            setSnippet(snippet === null ? '' : null);
            setSnippetError(null);
          }}
        />
      </div>
      {snippet !== null && (
        <div {...stylex.props(ui.snippet)}>
          <TextArea
            label="JSON snippet"
            value={snippet}
            rows={5}
            placeholder={'{ "mcpServers": { "name": { "command": "npx", "args": ["-y", "…"] } } }'}
            description="From a server's README. It fills in the form; nothing is saved yet."
            onChange={setSnippet}
          />
          {snippetError !== null && <Banner status="error" title={snippetError} />}
          <div>
            <Button
              label="Fill the form"
              size="sm"
              variant="secondary"
              isDisabled={snippet.trim() === ''}
              onClick={importSnippet}
            />
          </div>
        </div>
      )}
    </>
  );
}

/** Command or link, and the one box for whichever it is. */
export function ReachFields({ form, change }: FieldsProps) {
  return (
    <>
      <SegmentedControl
        label="How the server is reached"
        value={form.transport}
        onChange={(transport) => change({ transport: transport as FormValues['transport'] })}
        size="sm"
        layout="fill"
      >
        <SegmentedControlItem
          value="stdio"
          label="Command"
          icon={<Icon icon={Terminal} size="sm" />}
        />
        <SegmentedControlItem
          value="streamable-http"
          label="Link"
          icon={<Icon icon={Globe} size="sm" />}
        />
      </SegmentedControl>
      {form.transport === 'streamable-http' ? (
        <TextInput
          label="Link"
          isLabelHidden
          value={form.url}
          placeholder="https://example.com/mcp"
          description="A Streamable HTTP server."
          size="sm"
          onChange={(url) => change({ url })}
        />
      ) : (
        <TextArea
          label="Command"
          isLabelHidden
          value={form.command}
          rows={3}
          placeholder="npx -y @modelcontextprotocol/server-postgres postgresql://user:pass@host/db"
          description="Runs on this machine. A whole command is split into the program and one argument per word; quote a word that holds a space."
          onChange={(command) => change({ command })}
        />
      )}
    </>
  );
}

/** What the server is given: environment variables, or headers and a token. Write-only. */
export function SecretsFields({ form, change, editing }: FieldsProps) {
  const remote = form.transport === 'streamable-http';
  const saved = editing !== null && (editing.hasCredentials || editing.credentialsPersisted);

  return (
    <>
      {remote && (
        <TextInput
          label="Bearer token"
          type="password"
          value={form.bearerToken}
          placeholder="Optional"
          size="sm"
          onChange={(bearerToken) => change({ bearerToken, clearCredentials: false })}
        />
      )}
      <Pairs
        label={remote ? 'header' : 'variable'}
        keyLabel={remote ? 'Header' : 'Variable'}
        pairs={remote ? form.headers : form.env}
        onChange={(pairs) =>
          change(
            remote
              ? { headers: pairs, clearCredentials: false }
              : { env: pairs, clearCredentials: false },
          )
        }
      />
      {saved && (
        <div {...stylex.props(ui.saved)}>
          <Text type="supporting" color="secondary">
            {form.clearCredentials
              ? 'The saved values will be cleared when you save.'
              : editing?.credentialsPersisted && !editing.hasCredentials
                ? 'Saved values exist but cannot be opened on this device. Adding any here replaces them.'
                : 'Saved values are encrypted and never shown. Adding any here replaces them.'}
          </Text>
          <Button
            label={form.clearCredentials ? 'Keep them' : 'Clear them'}
            size="sm"
            variant="ghost"
            onClick={() => change({ clearCredentials: !form.clearCredentials })}
          />
        </div>
      )}
    </>
  );
}

export function AdvancedFields({ form, change }: FieldsProps) {
  return (
    <TextInput
      label="Working folder"
      value={form.cwd}
      placeholder="Inherited from the chat"
      description="Where the command runs."
      size="sm"
      onChange={(cwd) => change({ cwd })}
    />
  );
}

/** The whole form: four ruled sections, one after another. */
export function McpServerForm(props: FieldsProps) {
  const { form } = props;
  const remote = form.transport === 'streamable-http';
  const text = sectionText(remote);

  return (
    <div {...stylex.props(ui.form)}>
      <section {...stylex.props(ui.section)}>
        <Text type="label" weight="medium">
          {text.server.title}
        </Text>
        <ServerFields {...props} />
      </section>

      <section {...stylex.props(ui.section)}>
        <div {...stylex.props(ui.sectionText)}>
          <Text type="label" weight="medium">
            {text.reach.title}
          </Text>
          <Text type="supporting" color="secondary">
            {text.reach.hint}
          </Text>
        </div>
        <ReachFields {...props} />
      </section>

      <section {...stylex.props(ui.section)}>
        <div {...stylex.props(ui.sectionText)}>
          <Text type="label" weight="medium">
            {text.secrets.title}
          </Text>
          <Text type="supporting" color="secondary">
            {text.secrets.hint}
          </Text>
        </div>
        <SecretsFields {...props} />
      </section>

      {!remote && (
        <section {...stylex.props(ui.section)}>
          <Collapsible
            defaultIsOpen={form.cwd !== ''}
            trigger={
              <Text type="label" weight="medium">
                {text.advanced.title}
              </Text>
            }
          >
            <div {...stylex.props(ui.advanced)}>
              <AdvancedFields {...props} />
            </div>
          </Collapsible>
        </section>
      )}
    </div>
  );
}

/** Name and value rows, as many as there are; blank rows are ignored on save. */
function Pairs({
  label,
  keyLabel,
  pairs,
  onChange,
}: {
  label: string;
  keyLabel: string;
  pairs: Pair[];
  onChange: (pairs: Pair[]) => void;
}) {
  const set = (index: number, next: Partial<Pair>): void =>
    onChange(pairs.map((pair, at) => (at === index ? { ...pair, ...next } : pair)));

  return (
    <div {...stylex.props(ui.pairs)}>
      {pairs.map((pair, index) => (
        <div key={index} {...stylex.props(ui.row)}>
          <TextInput
            label={`${keyLabel} name`}
            isLabelHidden
            value={pair.key}
            placeholder={keyLabel}
            size="sm"
            onChange={(key) => set(index, { key })}
          />
          <TextInput
            label={`${keyLabel} value`}
            isLabelHidden
            type="password"
            value={pair.value}
            placeholder="Value"
            size="sm"
            onChange={(value) => set(index, { value })}
          />
          <IconButton
            label={`Remove ${label}`}
            icon={<Icon icon={X} size="sm" />}
            size="sm"
            variant="ghost"
            onClick={() => onChange(pairs.filter((_, at) => at !== index))}
          />
        </div>
      ))}
      <div>
        <Button
          label={`Add ${label}`}
          size="sm"
          variant="ghost"
          icon={<Icon icon={Plus} size="sm" />}
          onClick={() => onChange([...pairs, { key: '', value: '' }])}
        />
      </div>
    </div>
  );
}

/** Save and cancel, with whatever the main process refused and what is still missing. */
export function SaveRow({
  editor,
  model,
  label,
  cancelLabel,
  onCancel,
}: {
  editor: ReturnType<typeof useServerEditor>;
  model: McpModel;
  label: string;
  cancelLabel?: string;
  onCancel?: () => void;
}) {
  return (
    <div {...stylex.props(ui.save)}>
      {model.problem !== null && (
        <Banner status="error" title="Could not save" description={model.problem} />
      )}
      <div {...stylex.props(ui.saveRow)}>
        <Button
          label={model.busy ? 'Saving' : label}
          size="sm"
          variant="primary"
          isDisabled={!editor.ready || !editor.dirty}
          onClick={() => void editor.save()}
        />
        {onCancel && (
          <Button
            label={cancelLabel ?? 'Cancel'}
            size="sm"
            variant="ghost"
            isDisabled={model.busy}
            onClick={onCancel}
          />
        )}
        <Text type="supporting" color="secondary">
          {editor.dirty ? (editor.missing ?? ' ') : ' '}
        </Text>
      </div>
    </div>
  );
}

/** Removing a server is asked, since it also drops what it was given. */
export function ConfirmRemove({
  server,
  model,
  onDone,
}: {
  server: McpServer;
  model: McpModel;
  onDone: (removed: boolean) => void;
}) {
  return (
    <AlertDialog
      isOpen
      onOpenChange={(open) => {
        if (!open) onDone(false);
      }}
      title={`Remove ${server.name}?`}
      description="Kira stops offering its tools, and any credentials saved for it are deleted."
      actionLabel="Remove server"
      onAction={() => void model.remove(server.id).then(onDone)}
    />
  );
}

const ui = stylex.create({
  form: { display: 'flex', flexDirection: 'column' },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-3'],
    paddingBlock: spacingVars['--spacing-4'],
    borderBlockStartWidth: borderVars['--border-width'],
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: colorVars['--color-border'],
  },
  snippetRow: { display: 'flex' },
  sectionText: { display: 'flex', flexDirection: 'column', gap: 2 },
  snippet: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-2'] },
  pair: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
    gap: spacingVars['--spacing-3'],
    alignItems: 'start',
  },
  pairs: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-2'] },
  row: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr) auto',
    gap: spacingVars['--spacing-2'],
    alignItems: 'center',
  },
  saved: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingVars['--spacing-3'],
    fontSize: textSizeVars['--font-size-sm'],
  },
  advanced: { paddingBlockStart: spacingVars['--spacing-3'] },
  save: { display: 'flex', flexDirection: 'column', gap: spacingVars['--spacing-3'] },
  saveRow: { display: 'flex', alignItems: 'center', gap: spacingVars['--spacing-2'] },
});
