import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Divider } from '@astryxdesign/core/Divider';
import { Icon } from '@astryxdesign/core/Icon';
import { Text } from '@astryxdesign/core/Text';
import * as stylex from '@stylexjs/stylex';
import { ExternalLink, GitBranch, Laptop, Terminal } from 'lucide-react';
import { useState } from 'react';
import type { ExecutionWorkspace, Ticket, TicketSaid } from '../../preload/bridge.ts';
import {
  executionPreviewLabel,
  executionStatusLabel,
  executionWorkspaceView,
  type ExecutionWorkspaceView,
} from './executionWorkspace.ts';

export function ExecutionWorkspacePanel({
  ticket,
  workspaces,
}: {
  ticket: Ticket;
  workspaces: ExecutionWorkspace[];
}) {
  const [selectedId, setSelectedId] = useState(workspaces[0]?.id ?? null);
  const selected = workspaces.find((workspace) => workspace.id === selectedId) ?? workspaces[0];

  if (selected === undefined) return null;

  const view = executionWorkspaceView(selected, ticket);

  return (
    <section {...stylex.props(styles.section)} aria-label="Execution workspaces">
      <div {...stylex.props(styles.heading)}>
        <div>
          <Text type="label" weight="medium">
            Execution workspace
          </Text>
          <Text type="supporting" color="secondary">
            Follow the agent, checkout, changed work, and preview from this issue.
          </Text>
        </div>
        <Badge
          label={executionStatusLabel(view.status)}
          variant={
            view.status === 'failed'
              ? 'warning'
              : view.status === 'completed'
                ? 'success'
                : 'neutral'
          }
        />
      </div>

      {workspaces.length > 1 && (
        <div {...stylex.props(styles.choices)}>
          {workspaces.map((workspace) => {
            const choice = executionWorkspaceView(workspace, ticket);
            return (
              <Button
                key={workspace.id}
                label={`${workspace.branch} · ${executionStatusLabel(choice.status)}`}
                size="sm"
                variant={workspace.id === selected.id ? 'primary' : 'ghost'}
                onClick={() => setSelectedId(workspace.id)}
              />
            );
          })}
        </div>
      )}

      <WorkspaceDetails ticket={ticket} view={view} />
    </section>
  );
}

function WorkspaceDetails({ ticket, view }: { ticket: Ticket; view: ExecutionWorkspaceView }) {
  const [said, setSaid] = useState<TicketSaid[] | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);

  const readOutput = async (): Promise<void> => {
    if (view.run === null) return;
    const answer = await window.kira.readTranscript(ticket.id, view.run.id);
    if (!answer.ok) {
      setTrouble(answer.error);
      return;
    }
    setTrouble(null);
    setSaid(answer.value);
  };

  return (
    <>
      <div {...stylex.props(styles.meta)}>
        <div {...stylex.props(styles.metaItem)}>
          <Icon icon={Laptop} size="sm" />
          <Text type="supporting">{view.repository}</Text>
        </div>
        <div {...stylex.props(styles.metaItem)}>
          <Icon icon={GitBranch} size="sm" />
          <Text type="supporting">{view.branch}</Text>
        </div>
        <Text type="supporting" color="secondary">
          base {view.workspace.baseBranch} · agent {view.workspace.agentConfig}
        </Text>
      </div>

      <Divider />

      <div {...stylex.props(styles.block)}>
        <div {...stylex.props(styles.blockHeading)}>
          <Icon icon={Terminal} size="sm" />
          <Text type="label" weight="medium">
            Agent and process output
          </Text>
        </div>
        {view.run === null ? (
          <Text type="supporting" color="secondary">
            The agent session has not started yet.
          </Text>
        ) : (
          <>
            <Button
              label="Refresh output"
              size="sm"
              variant="secondary"
              onClick={() => void readOutput()}
            />
            {trouble !== null && (
              <Text type="supporting" color="secondary">
                {trouble}
              </Text>
            )}
            {said !== null &&
              (said.length === 0 ? (
                <Text type="supporting" color="secondary">
                  {view.status === 'running'
                    ? 'No output yet. The agent is still working.'
                    : 'No agent output was recorded.'}
                </Text>
              ) : (
                <ul {...stylex.props(styles.output)}>
                  {said.map((line) => (
                    <li key={line.id}>
                      <Text type="supporting" color="secondary">
                        {line.saidBy}
                      </Text>
                      <Text type="body">{line.words}</Text>
                    </li>
                  ))}
                </ul>
              ))}
            {view.processes.length > 0 && (
              <ul {...stylex.props(styles.output)}>
                {view.processes.map((process) => (
                  <li key={process}>
                    <Text type="code">{process}</Text>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <div {...stylex.props(styles.block)}>
        <Text type="label" weight="medium">
          Changed work
        </Text>
        <Text type="supporting" color="secondary">
          {view.changed ??
            (view.status === 'running'
              ? 'No changed work has been recorded yet.'
              : 'No changed work was recorded.')}
        </Text>
      </div>

      <div {...stylex.props(styles.block)}>
        <div {...stylex.props(styles.blockHeading)}>
          <Icon icon={ExternalLink} size="sm" />
          <Text type="label" weight="medium">
            Development preview
          </Text>
        </div>
        <Text type="supporting" color="secondary">
          {executionPreviewLabel(view.preview)}
        </Text>
      </div>
    </>
  );
}

const styles = stylex.create({
  section: { display: 'grid', gap: 'var(--spacing-3)', paddingBlock: 'var(--spacing-4)' },
  heading: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 'var(--spacing-3)',
  },
  choices: { display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-2)' },
  meta: { display: 'grid', gap: 'var(--spacing-2)' },
  metaItem: { display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' },
  block: { display: 'grid', gap: 'var(--spacing-2)' },
  blockHeading: { display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' },
  output: {
    display: 'grid',
    gap: 'var(--spacing-2)',
    margin: 0,
    paddingInlineStart: 'var(--spacing-4)',
  },
});
