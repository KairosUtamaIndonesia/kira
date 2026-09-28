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
    width: '100%',
    maxWidth: 1040,
    marginInline: 'auto',
    padding: spacingVars['--spacing-6'],
  },
  intro: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-2'],
    maxWidth: 680,
    paddingBlockEnd: spacingVars['--spacing-6'],
  },
  projectHeading: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-1'],
    paddingBlockEnd: spacingVars['--spacing-2'],
  },
  projectRow: {
    marginBlockEnd: spacingVars['--spacing-2'],
    borderWidth: borderVars['--border-width'],
    borderStyle: 'solid',
    borderColor: colorVars['--color-border'],
    borderRadius: 10,
    backgroundColor: colorVars['--color-background-card'],
  },
  projectStart: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-2'],
  },
  workspaceList: {
    marginBlockStart: spacingVars['--spacing-3'],
    padding: spacingVars['--spacing-4'],
    borderWidth: borderVars['--border-width'],
    borderStyle: 'solid',
    borderColor: colorVars['--color-background-muted'],
    borderRadius: 10,
    backgroundColor: colorVars['--color-background-muted'],
  },
  workspaceHeading: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-1'],
    paddingBlockEnd: spacingVars['--spacing-2'],
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
              description="Projects shared with your account appear here. Choose one to open its ticket queue and the local folder where agent work runs."
              icon={<Icon icon={Ticket} size="lg" />}
              headingLevel={2}
            />
          )}

          {projects !== null && projects.length > 0 && (
            <>
              <section {...stylex.props(styles.intro)}>
                <Text type="large" weight="medium">
                  Choose a project
                </Text>
                <Text type="supporting" color="secondary">
                  Each project has one shared ticket queue. A linked workspace is the local folder
                  where its agents run.
                </Text>
              </section>
              <div {...stylex.props(styles.projectHeading)}>
                <Text type="label" weight="medium">
                  Available projects
                </Text>
                <Text type="supporting" color="secondary">
                  {projects.length} {projects.length === 1 ? 'project' : 'projects'} shared with you
                </Text>
              </div>
              <div>
                {projects.map((project) => {
                  const linked = projectWorkspaces(project, workspaces);
                  const selected = selectedProjectId === project.id;
                  const destination = destinationForProject(project, workspaces);
                  const actionLabel =
                    destination.kind === 'open'
                      ? 'Open queue'
                      : destination.kind === 'choose'
                        ? selected
                          ? 'Hide workspaces'
                          : 'Choose workspace'
                        : 'Link this folder';
                  const description =
                    linked.length === 0
                      ? 'No local workspace linked'
                      : linked.length === 1
                        ? `Workspace · ${linked[0]!.name}`
                        : `${linked.length} local workspaces`;

                  return (
                    <div key={project.id} {...stylex.props(styles.projectRow)}>
                      <Item
                        label={project.name}
                        description={
                          <span {...stylex.props(styles.projectStart)}>
                            <Text type="supporting" color="secondary">
                              {project.prefix}
                            </Text>
                            <Text type="supporting" color="secondary">
                              {description}
                            </Text>
                          </span>
                        }
                        startContent={<Icon icon={Ticket} size="sm" />}
                        endContent={
                          <Button
                            label={actionLabel}
                            size="sm"
                            variant={destination.kind === 'open' ? 'primary' : 'secondary'}
                            isDisabled={isLinking}
                            onClick={(event) => {
                              event.stopPropagation();
                              void openProject(project);
                            }}
                          />
                        }
                        isDisabled={isLinking}
                        onClick={() => void openProject(project)}
                      />
                    </div>
                  );
                })}
              </div>
              {selectedProject !== null && selectedWorkspaces.length > 1 && (
                <section {...stylex.props(styles.workspaceList)}>
                  <div {...stylex.props(styles.workspaceHeading)}>
                    <Text type="label" weight="medium">
                      Choose a workspace for {selectedProject.name}
                    </Text>
                    <Text type="supporting" color="secondary">
                      The ticket queue is shared; this choice selects where local agent runs happen.
                    </Text>
                  </div>
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
