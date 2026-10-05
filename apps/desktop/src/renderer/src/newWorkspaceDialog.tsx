/**
 * Starting a piece of work: a folder you already have, or a repository cloned here.
 *
 * A folder is opened as it always was, and what it turns out to be is the folder's
 * own answer — the repository it was cloned from is read from it and recorded when
 * the folder joins a project (ADR 0029). A repository is chosen from what the
 * connected GitHub App can see and cloned beside your other folders, by the same
 * reading. Either way the folder is remembered first and the project it works is
 * chosen next, on Work, where that question already has a home.
 *
 * The dialog stays open while the work happens and says what it is doing, because
 * a clone can take a while and a window that simply vanishes reads as a failure.
 */
import { Button } from '@astryxdesign/core/Button';
import { Dialog } from '@astryxdesign/core/Dialog';
import { Icon } from '@astryxdesign/core/Icon';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { spacingVars } from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { FolderOpen, GitBranch } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type {
  CloneRequest,
  InstallationRepository,
  WorkspaceSummary,
} from '../../preload/bridge.ts';
import { FlushDialogHeader } from './dialogHeader.tsx';

function useOnce(effect: () => void): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(effect, []);
}

export function NewWorkspaceDialog({
  onStarted,
  onClose,
}: {
  /** A workspace was made; take the person to where its project is chosen. */
  onStarted: (workspace: WorkspaceSummary) => void;
  onClose: () => void;
}) {
  const [cloning, setCloning] = useState(false);
  const [query, setQuery] = useState('');
  const [available, setAvailable] = useState<InstallationRepository[] | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  /** What is happening right now, or null when nothing is. */
  const [busy, setBusy] = useState<string | null>(null);

  /** What the App can see, read only once the person has asked to clone. */
  const load = useCallback(async () => {
    const connections = await window.kira.loadGitConnections();
    if (!connections.ok) {
      setTrouble(connections.error);
      setAvailable([]);
      return;
    }

    const app = connections.value.find(
      (each) => each.provider === 'github' && each.authKind === 'app',
    );
    if (app === undefined) {
      setTrouble('No GitHub App is connected, so there is nothing here to clone.');
      setAvailable([]);
      return;
    }

    const answer = await window.kira.listConnectionRepositories(app.id);
    if (answer.ok) {
      setAvailable(answer.value);
      setTrouble(null);
    } else {
      setTrouble(answer.error);
      setAvailable([]);
    }
  }, []);

  useOnce(() => {
    void load();
  });

  async function openFolder(): Promise<void> {
    setBusy('Waiting for a folder…');
    const answer = await window.kira.addWorkspace();
    setBusy(null);

    if (!answer.ok) {
      setTrouble(answer.error);
      return;
    }
    // A picker closed without a choice is an answer, not a failure.
    if (answer.value !== null) onStarted(answer.value);
  }

  async function clone(request: CloneRequest): Promise<void> {
    setBusy(`Cloning ${request.owner}/${request.name}…`);
    const answer = await window.kira.cloneWorkspace(request);
    setBusy(null);

    if (!answer.ok) {
      setTrouble(answer.error);
      return;
    }
    if (answer.value !== null) onStarted(answer.value);
  }

  const asked = query.trim().toLowerCase();
  const matches = (available ?? []).filter((each) =>
    `${each.owner}/${each.name}`.toLowerCase().includes(asked),
  );

  return (
    <Dialog
      isOpen
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      purpose="form"
      width={560}
    >
      <FlushDialogHeader
        title="New workspace"
        subtitle="A folder to work in"
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
      />
      <div {...stylex.props(ui.body)}>
        {busy !== null ? (
          <Text color="secondary">{busy}</Text>
        ) : !cloning ? (
          <>
            <Text type="supporting" color="secondary">
              Open a folder you already have, or clone a repository the connected GitHub App can
              see.
            </Text>
            {trouble !== null && (
              <Text type="supporting" color="secondary">
                {trouble}
              </Text>
            )}
            <div {...stylex.props(ui.choices)}>
              <Button
                label="Open a folder"
                icon={<Icon icon={FolderOpen} size="sm" />}
                variant="secondary"
                onClick={() => void openFolder()}
              />
              <Button
                label="Clone a repository"
                icon={<Icon icon={GitBranch} size="sm" />}
                variant="secondary"
                onClick={() => {
                  setTrouble(null);
                  setCloning(true);
                }}
              />
            </div>
          </>
        ) : (
          <>
            {trouble !== null && (
              <Text type="supporting" color="secondary">
                {trouble}
              </Text>
            )}

            <TextInput
              label="Find a repository"
              value={query}
              placeholder="kira"
              size="sm"
              onChange={setQuery}
            />

            {available === null ? (
              <Text type="supporting" color="secondary">
                Reading what the App can see…
              </Text>
            ) : matches.length === 0 ? (
              <Text type="supporting" color="secondary">
                {asked === ''
                  ? 'That App can see no repositories.'
                  : `Nothing matches “${query.trim()}”.`}
              </Text>
            ) : (
              <>
                <Text type="supporting" color="secondary">
                  {`${matches.length} of ${available.length} · then a folder to clone into`}
                </Text>
                <ul {...stylex.props(ui.list)}>
                  {matches.map((each) => (
                    <li key={`${each.owner}/${each.name}`}>
                      <Button
                        label={`${each.owner}/${each.name}`}
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void clone({ provider: 'github', owner: each.owner, name: each.name })
                        }
                      />
                    </li>
                  ))}
                </ul>
              </>
            )}

            <div {...stylex.props(ui.back)}>
              <Button
                label="Back"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setTrouble(null);
                  setCloning(false);
                }}
              />
            </div>
          </>
        )}
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
  choices: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: spacingVars['--spacing-2'],
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: spacingVars['--spacing-1'],
    margin: 0,
    padding: 0,
    listStyle: 'none',
    maxHeight: 240,
    overflowY: 'auto',
  },
  back: {
    display: 'flex',
    justifyContent: 'flex-start',
  },
});
