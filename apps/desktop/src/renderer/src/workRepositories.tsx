/**
 * A project's repositories: where its work happens and its pull requests come from.
 *
 * A pull request is only watched once its repository is on this list, because the
 * list is what tells the server which project a delivery belongs to. A person
 * attaches and removes them here; the webhook secret for a self-hosted host is
 * configured at the host, not in this dialog (docs/adr/0026).
 */
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Dialog } from '@astryxdesign/core/Dialog';
import { Icon } from '@astryxdesign/core/Icon';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { spacingVars } from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { GitBranch, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { Repository } from '../../preload/bridge.ts';
import { FlushDialogHeader } from './dialogHeader.tsx';
import { copy } from './workCopy.ts';

const HOSTS = [
  { value: 'github', label: 'GitHub' },
  { value: 'forgejo', label: 'Forgejo' },
  { value: 'gitea', label: 'Gitea' },
  { value: 'gitlab', label: 'GitLab' },
];

function useOnce(effect: () => void): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(effect, []);
}

export function RepositoriesDialog({
  projectId,
  projectName,
  onClose,
}: {
  projectId: string;
  projectName: string;
  onClose: () => void;
}) {
  const [repositories, setRepositories] = useState<Repository[] | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [provider, setProvider] = useState('github');
  const [owner, setOwner] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const answer = await window.kira.loadRepositories(projectId);
    if (answer.ok) {
      setRepositories(answer.value);
      setTrouble(null);
    } else {
      setTrouble(answer.error);
    }
  }, [projectId]);

  useOnce(() => {
    void load();
  });

  async function attach(): Promise<void> {
    if (busy || owner.trim() === '' || name.trim() === '') return;

    setBusy(true);
    const answer = await window.kira.attachRepository(projectId, {
      owner: owner.trim(),
      name: name.trim(),
      provider,
    });
    setBusy(false);

    if (!answer.ok) {
      setTrouble(answer.error);
      return;
    }

    setOwner('');
    setName('');
    setTrouble(null);
    await load();
  }

  async function remove(id: string): Promise<void> {
    setBusy(true);
    const answer = await window.kira.detachRepository(projectId, id);
    setBusy(false);

    if (!answer.ok) {
      setTrouble(answer.error);
      return;
    }

    await load();
  }

  return (
    <Dialog
      isOpen
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      purpose="form"
      width={560}
    >
      <FlushDialogHeader
        title={copy.repositories.title}
        subtitle={copy.repositories.subtitle(projectName)}
        onOpenChange={(next) => {
          if (!next && !busy) onClose();
        }}
      />
      <div {...stylex.props(ui.body)}>
        {trouble !== null && (
          <Banner status="error" title={copy.repositories.failed} description={trouble} />
        )}

        {repositories === null ? (
          <Text type="supporting" color="secondary">
            {copy.repositories.loading}
          </Text>
        ) : repositories.length === 0 ? (
          <Text type="supporting" color="secondary">
            {copy.repositories.empty}
          </Text>
        ) : (
          <ul {...stylex.props(ui.list)}>
            {repositories.map((repository) => (
              <li key={repository.id} {...stylex.props(ui.row)}>
                <Icon icon={GitBranch} size="sm" />
                <span {...stylex.props(ui.remote)}>
                  <Text type="body">{`${repository.owner}/${repository.name}`}</Text>
                  <Text type="supporting" color="secondary">
                    {`${repository.provider} · ${copy.repositories.defaultBranch(repository.defaultBranch)}`}
                  </Text>
                </span>
                <Button
                  label={copy.repositories.remove(repository.owner, repository.name)}
                  icon={<Icon icon={Trash2} size="sm" />}
                  size="sm"
                  variant="ghost"
                  isDisabled={busy}
                  onClick={() => void remove(repository.id)}
                />
              </li>
            ))}
          </ul>
        )}

        <div {...stylex.props(ui.form)}>
          <Selector
            label={copy.repositories.provider}
            options={HOSTS}
            value={provider}
            isDisabled={busy}
            onChange={(value) => setProvider(value ?? 'github')}
          />
          <TextInput
            label={copy.repositories.owner}
            value={owner}
            placeholder={copy.repositories.ownerPlaceholder}
            size="sm"
            onChange={setOwner}
          />
          <TextInput
            label={copy.repositories.name}
            value={name}
            placeholder={copy.repositories.namePlaceholder}
            size="sm"
            onChange={setName}
          />
          <div {...stylex.props(ui.formActions)}>
            <Button
              label={busy ? copy.repositories.attaching : copy.repositories.attach}
              size="sm"
              variant="primary"
              isDisabled={busy || owner.trim() === '' || name.trim() === ''}
              onClick={() => void attach()}
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
    alignItems: 'center',
    gap: spacingVars['--spacing-3'],
  },
  remote: {
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
  },
});
