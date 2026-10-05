/**
 * Starting a piece of work: a folder you already have, or a repository cloned here.
 *
 * A folder is opened as it always was, and what it turns out to be is the folder's
 * own answer — the repository it was cloned from is read from it and recorded when
 * the folder joins a project (ADR 0029). A repository is chosen from what the
 * connected GitHub App can see and cloned beside your other folders, by the same
 * reading. Either way the folder is remembered first and the project it works is
 * chosen next, on Work, where that question already has a home.
 */
import { Button } from '@astryxdesign/core/Button';
import { Dialog } from '@astryxdesign/core/Dialog';
import { Icon } from '@astryxdesign/core/Icon';
import { Text } from '@astryxdesign/core/Text';
import { spacingVars } from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { FolderOpen, GitBranch } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { CloneRequest, InstallationRepository } from '../../preload/bridge.ts';
import { FlushDialogHeader } from './dialogHeader.tsx';

function useOnce(effect: () => void): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(effect, []);
}

export function NewWorkspaceDialog({
  onOpenFolder,
  onClone,
  onClose,
}: {
  onOpenFolder: () => void;
  onClone: (request: CloneRequest) => void;
  onClose: () => void;
}) {
  const [choosing, setChoosing] = useState(false);
  const [available, setAvailable] = useState<InstallationRepository[] | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);

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
        {!choosing ? (
          <>
            <Text type="supporting" color="secondary">
              Open a folder you already have, or clone a repository the connected GitHub App can
              see.
            </Text>
            <div {...stylex.props(ui.choices)}>
              <Button
                label="Open a folder"
                icon={<Icon icon={FolderOpen} size="sm" />}
                variant="secondary"
                onClick={onOpenFolder}
              />
              <Button
                label="Clone a repository"
                icon={<Icon icon={GitBranch} size="sm" />}
                variant="secondary"
                onClick={() => setChoosing(true)}
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

            {available !== null && available.length > 0 && (
              <>
                <Text type="supporting" color="secondary">
                  Choose a repository, then a folder to clone it into.
                </Text>
                <ul {...stylex.props(ui.list)}>
                  {available.map((each) => (
                    <li key={`${each.owner}/${each.name}`}>
                      <Button
                        label={`${each.owner}/${each.name}`}
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          onClone({ provider: 'github', owner: each.owner, name: each.name })
                        }
                      />
                    </li>
                  ))}
                </ul>
              </>
            )}

            <div {...stylex.props(ui.back)}>
              <Button label="Back" size="sm" variant="ghost" onClick={() => setChoosing(false)} />
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
