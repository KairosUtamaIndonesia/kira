/**
 * A project's skills: the methods its work is done by.
 *
 * A skill is instructions every chat in the project can use. This is where a
 * person writes one; Kira writes them from a chat, and both land in the same
 * store, so a skill written here is one she can also change
 * (docs/adr/0027-project-skills-live-in-the-store.md).
 */
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Dialog } from '@astryxdesign/core/Dialog';
import { Icon } from '@astryxdesign/core/Icon';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { spacingVars } from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { Pencil, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { ProjectSkill, SkillDraft } from '../../preload/bridge.ts';
import { FlushDialogHeader } from './dialogHeader.tsx';
import { copy } from './workCopy.ts';

/** What the form is holding, whether it is writing a new skill or editing one. */
interface Draft {
  name: string;
  description: string;
  body: string;
}

const EMPTY: Draft = { name: '', description: '', body: '' };

function useOnce(effect: () => void): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(effect, []);
}

export function SkillsDialog({
  projectId,
  projectName,
  onClose,
}: {
  projectId: string;
  projectName: string;
  onClose: () => void;
}) {
  const [skills, setSkills] = useState<ProjectSkill[] | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  /** The skill being edited, or null while the form is writing a new one. */
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const answer = await window.kira.loadSkills(projectId);
    if (answer.ok) {
      setSkills(answer.value);
      setTrouble(null);
    } else {
      setTrouble(answer.error);
    }
  }, [projectId]);

  useOnce(() => {
    void load();
  });

  function reset(): void {
    setDraft(EMPTY);
    setEditing(null);
  }

  async function save(): Promise<void> {
    if (busy || draft.name.trim() === '' || draft.description.trim() === '') return;

    setBusy(true);
    const write: SkillDraft = {
      name: draft.name.trim(),
      description: draft.description.trim(),
      body: draft.body,
    };
    const answer =
      editing === null
        ? await window.kira.writeSkill(projectId, write)
        : await window.kira.changeSkill(projectId, editing, write);
    setBusy(false);

    if (!answer.ok) {
      setTrouble(answer.error);
      return;
    }

    reset();
    setTrouble(null);
    await load();
  }

  async function remove(id: string): Promise<void> {
    setBusy(true);
    const answer = await window.kira.removeSkill(projectId, id);
    setBusy(false);

    if (!answer.ok) {
      setTrouble(answer.error);
      return;
    }

    // Deleting the skill the form was editing leaves the form writing a new one
    // rather than holding a row that is gone.
    if (editing === id) reset();
    await load();
  }

  return (
    <Dialog
      isOpen
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      purpose="form"
      width={600}
    >
      <FlushDialogHeader
        title={copy.skills.title}
        subtitle={copy.skills.subtitle(projectName)}
        onOpenChange={(next) => {
          if (!next && !busy) onClose();
        }}
      />
      <div {...stylex.props(ui.body)}>
        {trouble !== null && (
          <Banner status="error" title={copy.skills.refused} description={trouble} />
        )}

        {skills === null ? (
          <Text type="supporting" color="secondary">
            {copy.skills.loading}
          </Text>
        ) : skills.length === 0 ? (
          <Text type="supporting" color="secondary">
            {copy.skills.empty}
          </Text>
        ) : (
          <ul {...stylex.props(ui.list)}>
            {skills.map((skill) => (
              <li key={skill.id} {...stylex.props(ui.row)}>
                <span {...stylex.props(ui.entry)}>
                  <Text type="body">{skill.name}</Text>
                  <Text type="supporting" color="secondary">
                    {skill.description}
                  </Text>
                  {skill.chatId !== null && (
                    <Text type="supporting" color="secondary">
                      {copy.skills.fromChat}
                    </Text>
                  )}
                </span>
                <Button
                  label={copy.skills.edit(skill.name)}
                  icon={<Icon icon={Pencil} size="sm" />}
                  size="sm"
                  variant="ghost"
                  isDisabled={busy}
                  onClick={() => {
                    setEditing(skill.id);
                    setDraft({
                      name: skill.name,
                      description: skill.description,
                      body: skill.body,
                    });
                    setTrouble(null);
                  }}
                />
                <Button
                  label={copy.skills.remove(skill.name)}
                  icon={<Icon icon={Trash2} size="sm" />}
                  size="sm"
                  variant="ghost"
                  isDisabled={busy}
                  onClick={() => void remove(skill.id)}
                />
              </li>
            ))}
          </ul>
        )}

        <div {...stylex.props(ui.form)}>
          <TextInput
            label={copy.skills.name}
            value={draft.name}
            placeholder={copy.skills.namePlaceholder}
            size="sm"
            isDisabled={busy}
            description={copy.skills.nameHint}
            onChange={(value) => setDraft((held) => ({ ...held, name: value }))}
          />
          <TextInput
            label={copy.skills.description}
            value={draft.description}
            placeholder={copy.skills.descriptionPlaceholder}
            size="sm"
            isDisabled={busy}
            onChange={(value) => setDraft((held) => ({ ...held, description: value }))}
          />
          <TextArea
            label={copy.skills.body}
            value={draft.body}
            placeholder={copy.skills.bodyPlaceholder}
            rows={8}
            isDisabled={busy}
            onChange={(value) => setDraft((held) => ({ ...held, body: value }))}
          />
          <div {...stylex.props(ui.formActions)}>
            {editing !== null && (
              <Button
                label={copy.skills.cancel}
                size="sm"
                variant="secondary"
                isDisabled={busy}
                onClick={reset}
              />
            )}
            <Button
              label={editing === null ? copy.skills.write : copy.skills.save}
              size="sm"
              variant="primary"
              isDisabled={busy || draft.name.trim() === '' || draft.description.trim() === ''}
              onClick={() => void save()}
            />
          </div>
        </div>
      </div>
    </Dialog>
  );
}

const ui = stylex.create({
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-4'],
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-2'],
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  row: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: spacingVars['--spacing-3'],
  },
  entry: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minWidth: 0,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-3'],
  },
  formActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: spacingVars['--spacing-2'],
  },
});

