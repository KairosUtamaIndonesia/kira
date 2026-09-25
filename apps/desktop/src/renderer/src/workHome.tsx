import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Icon } from '@astryxdesign/core/Icon';
import { Item } from '@astryxdesign/core/Item';
import { List } from '@astryxdesign/core/List';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Text } from '@astryxdesign/core/Text';
import { borderVars, colorVars, spacingVars } from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { Folder, Ticket } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ProjectSummary, WorkspaceSummary } from '../../preload/bridge.ts';
import { destinationForProject, projectWorkspaces } from './workNavigation.ts';

const styles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minWidth: 0,
    minHeight: 0,
  },
  top: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-1'],
    flexShrink: 0,
    paddingBlock: spacingVars['--spacing-4'],
    paddingInline: spacingVars['--spacing-5'],
    borderBlockEndWidth: borderVars['--border-width'],
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: colorVars['--color-background-muted'],
  },
  body: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
  },
  content: {
    maxWidth: 880,
    padding: spacingVars['--spacing-5'],
  },
  workspaceList: {
    paddingInlineStart: spacingVars['--spacing-5'],
    borderInlineStartWidth: borderVars['--border-width'],
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: colorVars['--color-background-muted'],
    marginInlineStart: spacingVars['--spacing-5'],
  },
  message: {
    padding: spacingVars['--spacing-4'],
  },
});

function useMountEffect(effect: () => void | (() => void)): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(effect, []);
}

export function WorkHome({
  workspaces,
  onOpenWorkspace,
  onLinkWorkspace,
}: {
  workspaces: readonly WorkspaceSummary[];
  onOpenWorkspace: (workspaceId: string) => void;
  onLinkWorkspace: (projectId: string) => Promise<string | null>;
}) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLinking, setIsLinking] = useState(false);

  async function readProjects(): Promise<void> {
    setIsLoading(true);
    const result = await window.kira.joinableProjects();
    setIsLoading(false);
    if (!result.ok) {
      setTrouble(result.error);
      setProjects(null);
      return;
    }
    setTrouble(null);
    setProjects(result.value);
  }

  // Loading the signed-in user's project list is the one external sync on mount.
  useMountEffect(() => {
    void readProjects();
  });

  async function openProject(project: ProjectSummary): Promise<void> {
    setTrouble(null);
    const destination = destinationForProject(project, workspaces);
    if (destination.kind === 'open') {
      onOpenWorkspace(destination.workspace.id);
      return;
    }
    if (destination.kind === 'choose') {
      setSelectedProjectId((selected) => (selected === project.id ? null : project.id));
      return;
    }

    setIsLinking(true);
    const error = await onLinkWorkspace(project.id);
    setIsLinking(false);
    if (error !== null) setTrouble(error);
  }

  const selectedProject = projects?.find((project) => project.id === selectedProjectId) ?? null;
  const selectedWorkspaces =
    selectedProject === null ? [] : projectWorkspaces(selectedProject, workspaces);

  return (
    <div {...stylex.props(styles.root)}>
      <header {...stylex.props(styles.top)}>
        <Text type="large" weight="medium">
          Work
        </Text>
        <Text type="supporting" color="secondary">
          Projects and the workspaces where you run their tickets.
        </Text>
      </header>

      <main {...stylex.props(styles.body)}>
        <div {...stylex.props(styles.content)}>
          {trouble !== null && (
            <div {...stylex.props(styles.message)}>
              <Banner
                status="error"
                title="Work could not continue"
                description={trouble}
                endContent={
                  <Button
                    label="Try again"
                    size="sm"
                    variant="secondary"
                    isDisabled={isLoading || isLinking}
                    onClick={() => void readProjects()}
                  />
                }
              />
            </div>
          )}

          {projects === null && trouble === null && (
            <div {...stylex.props(styles.message)} aria-busy="true" aria-label="Reading projects">
              <Skeleton width="35%" height={16} />
              <Skeleton width="75%" height={16} index={1} />
              <Skeleton width="65%" height={16} index={2} />
            </div>
          )}

          {projects !== null && projects.length === 0 && (
            <EmptyState
              title="No projects yet"
              description="Projects shared with your account appear here. Link a workspace to open its ticket queue."
              icon={<Icon icon={Ticket} size="lg" />}
              headingLevel={2}
            />
          )}

          {projects !== null && projects.length > 0 && (
            <>
              <Text type="label" weight="medium">
                Projects
              </Text>
              <List density="compact" hasDividers>
                {projects.map((project) => {
                  const linked = projectWorkspaces(project, workspaces);
                  const selected = selectedProjectId === project.id;
                  return (
                    <Item
                      key={project.id}
                      label={project.name}
                      description={`${project.prefix} · ${
                        linked.length === 0
                          ? 'No workspace linked'
                          : `${linked.length} linked ${linked.length === 1 ? 'workspace' : 'workspaces'}`
                      }`}
                      startContent={<Icon icon={Ticket} size="sm" />}
                      endContent={
                        <Text type="supporting" color="secondary">
                          {linked.length > 1
                            ? selected
                              ? 'Hide workspaces'
                              : 'Choose workspace'
                            : linked.length === 0
                              ? 'Link workspace'
                              : 'Open'}
                        </Text>
                      }
                      isDisabled={isLinking}
                      onClick={() => void openProject(project)}
                    />
                  );
                })}
              </List>
              {selectedProject !== null && selectedWorkspaces.length > 1 && (
                <section {...stylex.props(styles.workspaceList)}>
                  <Text type="label" weight="medium">
                    Choose a workspace for {selectedProject.name}
                  </Text>
                  <List density="compact">
                    {selectedWorkspaces.map((workspace) => (
                      <Item
                        key={workspace.id}
                        label={workspace.name}
                        description={workspace.folder}
                        startContent={<Icon icon={Folder} size="sm" />}
                        onClick={() => onOpenWorkspace(workspace.id)}
                      />
                    ))}
                  </List>
                </section>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
