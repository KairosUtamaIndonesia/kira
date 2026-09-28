import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Divider } from '@astryxdesign/core/Divider';
import { Icon } from '@astryxdesign/core/Icon';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Text } from '@astryxdesign/core/Text';
import * as stylex from '@stylexjs/stylex';
import { ExternalLink, GitBranch, Laptop, Terminal } from 'lucide-react';
import { useState } from 'react';
import type {
  ExecutionWorkspace,
  ExecutionReview,
  Ticket,
  TicketSaid,
} from '../../preload/bridge.ts';
import {
  executionPreviewLabel,
  executionStatusLabel,
  executionWorkspaceView,
  type ExecutionWorkspaceView,
} from './executionWorkspace.ts';

export function ExecutionWorkspacePanel({
  ticket,
  workspaces,
  repository,
  onStart,
  onChanged,
}: {
  ticket: Ticket;
  workspaces: ExecutionWorkspace[];
  repository: string;
  onStart: (executionWorkspaceId: string) => Promise<boolean>;
  onChanged: () => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState(workspaces[0]?.id ?? null);
  const selected = workspaces.find((workspace) => workspace.id === selectedId) ?? workspaces[0];
  const [creating, setCreating] = useState(false);
  const [starting, setStarting] = useState(false);

  const startWorkspace = async (id: string): Promise<void> => {
    setStarting(true);
    try {
      await onStart(id);
    } finally {
      setStarting(false);
    }
  };

  const workspaceCreated = async (id: string): Promise<void> => {
    setSelectedId(id);
    setCreating(false);
    await onChanged();
    if (ticket.band === 'ready') await startWorkspace(id);
  };

  if (selected === undefined) {
    return (
      <section {...stylex.props(styles.section)} aria-label="Execution workspaces">
        <WorkspaceForm ticket={ticket} repository={repository} onCreated={workspaceCreated} />
      </section>
    );
  }

  const view = executionWorkspaceView(selected, ticket);

  return (
    <section {...stylex.props(styles.section)} aria-label="Execution workspaces">
      <div {...stylex.props(styles.heading)}>
        <div>
          <Text type="label" weight="medium">
            Execution workspace
          </Text>
          <Text type="supporting" color="secondary">
            Follow the agent, checkout, changes, and review from this issue.
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

      {creating ? (
        <WorkspaceForm ticket={ticket} repository={repository} onCreated={workspaceCreated} />
      ) : (
        <Button
          label="Add execution workspace"
          size="sm"
          variant="secondary"
          onClick={() => setCreating(true)}
        />
      )}

      {ticket.band === 'ready' && view.status !== 'running' && (
        <Button
          label={view.run === null ? 'Start agent' : 'Run again'}
          size="sm"
          variant="primary"
          isDisabled={starting}
          onClick={() => void startWorkspace(selected.id)}
        />
      )}
      {ticket.band !== 'ready' && view.run === null && (
        <Text type="supporting" color="secondary">
          Mark this issue ready before starting its agent.
        </Text>
      )}

      <WorkspaceDetails key={selected.id} ticket={ticket} view={view} workspaceId={selected.id} />
    </section>
  );
}

function WorkspaceForm({
  ticket,
  repository: initialRepository,
  onCreated,
}: {
  ticket: Ticket;
  repository: string;
  onCreated: (id: string) => Promise<void>;
}) {
  const [repository, setRepository] = useState(initialRepository);
  const [baseBranch, setBaseBranch] = useState('main');
  const [branch, setBranch] = useState(ticket.branch);
  const [agentConfig, setAgentConfig] = useState('default');
  const [trouble, setTrouble] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async (): Promise<void> => {
    setBusy(true);
    const result = await window.kira.createExecutionWorkspace(ticket.id, {
      repository,
      baseBranch,
      branch,
      agentConfig,
    });
    setBusy(false);
    if (!result.ok) {
      setTrouble(result.error);
      return;
    }
    setTrouble(null);
    await onCreated(result.value.id);
  };

  return (
    <div {...stylex.props(styles.form)}>
      <Text type="label" weight="medium">
        Create execution workspace
      </Text>
      <Text type="supporting" color="secondary">
        Choose the repository, base branch, working branch, and agent configuration. Creating this
        workspace starts its agent when the issue is ready.
      </Text>
      <TextInput
        label="Repository folder"
        value={repository}
        onChange={setRepository}
        description="The local checkout the agent will work in."
        size="sm"
      />
      <TextInput label="Base branch" value={baseBranch} onChange={setBaseBranch} size="sm" />
      <TextInput label="Workspace branch" value={branch} onChange={setBranch} size="sm" />
      <TextInput
        label="Agent configuration"
        value={agentConfig}
        onChange={setAgentConfig}
        size="sm"
      />
      {trouble !== null && (
        <Text type="supporting" color="secondary">
          {trouble}
        </Text>
      )}
      <Button
        label={busy ? 'Creating workspace' : 'Create workspace and start agent'}
        size="sm"
        variant="primary"
        isDisabled={busy}
        onClick={() => void create()}
      />
    </div>
  );
}

function WorkspaceDetails({
  ticket,
  view,
  workspaceId,
}: {
  ticket: Ticket;
  view: ExecutionWorkspaceView;
  workspaceId: string;
}) {
  const [said, setSaid] = useState<TicketSaid[] | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [review, setReview] = useState<ExecutionReview | null>(null);
  const [path, setPath] = useState('');
  const [line, setLine] = useState('1');
  const [comment, setComment] = useState('');
  const [feedback, setFeedback] = useState('');
  const [diff, setDiff] = useState<string | null>(null);

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

  const readReview = async (): Promise<void> => {
    const answer = await window.kira.readExecutionReview(ticket.id, workspaceId);
    if (!answer.ok) {
      setTrouble(answer.error);
      return;
    }
    setTrouble(null);
    setReview(answer.value);
  };

  const readDiff = async (): Promise<void> => {
    const answer = await window.kira.readExecutionDiff(ticket.id, workspaceId);
    if (!answer.ok) {
      setTrouble(answer.error);
      return;
    }
    setTrouble(null);
    setDiff(answer.value);
  };

  const addComment = async (): Promise<void> => {
    const answer = await window.kira.addReviewComment(ticket.id, workspaceId, {
      path,
      line: Number(line),
      side: 'right',
      body: comment,
    });
    if (!answer.ok) {
      setTrouble(answer.error);
      return;
    }
    setComment('');
    await readReview();
  };

  const sendFeedback = async (): Promise<void> => {
    const answer = await window.kira.sendReviewFeedback(ticket.id, workspaceId, { body: feedback });
    if (!answer.ok) {
      setTrouble(answer.error);
      return;
    }
    setFeedback('');
    await readReview();
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
        <div {...stylex.props(styles.blockHeading)}>
          <Text type="label" weight="medium">
            Review and feedback
          </Text>
          <Button
            label="Refresh review"
            size="sm"
            variant="ghost"
            onClick={() => void readReview()}
          />
        </div>
        {review === null ? (
          <Text type="supporting" color="secondary">
            Refresh review to inspect comments and feedback for this workspace.
          </Text>
        ) : (
          <>
            {review.comments.length === 0 && review.feedback.length === 0 && (
              <Text type="supporting" color="secondary">
                No review comments or feedback yet.
              </Text>
            )}
            {review.comments.map((item) => (
              <div key={item.id} {...stylex.props(styles.reviewItem)}>
                <Text type="code">
                  {item.path}:{item.line} · {item.status}
                </Text>
                <Text type="supporting">{item.body}</Text>
                {item.status === 'open' && (
                  <Button
                    label="Mark addressed"
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      const answer = await window.kira.updateReviewComment(
                        ticket.id,
                        workspaceId,
                        item.id,
                        'addressed',
                      );
                      if (!answer.ok) setTrouble(answer.error);
                      else await readReview();
                    }}
                  />
                )}
              </div>
            ))}
            {review.feedback.map((item) => (
              <div key={item.id} {...stylex.props(styles.reviewItem)}>
                <Text type="supporting">Feedback: {item.body}</Text>
              </div>
            ))}
          </>
        )}
        <TextInput label="Changed file" value={path} onChange={setPath} size="sm" />
        <TextInput label="Line" value={line} onChange={setLine} size="sm" />
        <TextArea label="Inline comment" value={comment} onChange={setComment} rows={3} />
        <Button
          label="Add comment"
          size="sm"
          variant="secondary"
          isDisabled={path.trim() === '' || comment.trim() === ''}
          onClick={() => void addComment()}
        />
        <TextArea label="Feedback for the agent" value={feedback} onChange={setFeedback} rows={3} />
        <Button
          label="Send feedback"
          size="sm"
          variant="primary"
          isDisabled={feedback.trim() === ''}
          onClick={() => void sendFeedback()}
        />
      </div>

      <div {...stylex.props(styles.block)}>
        <div {...stylex.props(styles.blockHeading)}>
          <Text type="label" weight="medium">
            Changed work
          </Text>
          <Button label="View diff" size="sm" variant="secondary" onClick={() => void readDiff()} />
        </div>
        <Text type="supporting" color="secondary">
          {view.changed ??
            (view.status === 'running'
              ? 'No changed work has been recorded yet.'
              : 'No changed work was recorded.')}
        </Text>
        {diff !== null &&
          (diff === '' ? (
            <Text type="supporting" color="secondary">
              No tracked changes from the base branch.
            </Text>
          ) : (
            <pre {...stylex.props(styles.diff)}>{diff}</pre>
          ))}
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
  form: { display: 'grid', gap: 'var(--spacing-2)' },
  reviewItem: { display: 'grid', gap: 'var(--spacing-1)', paddingBlock: 'var(--spacing-2)' },
  diff: {
    overflowX: 'auto',
    maxHeight: 480,
    padding: 'var(--spacing-3)',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--color-background-muted)',
    fontFamily: 'var(--font-family-mono)',
    fontSize: 'var(--font-size-sm)',
    whiteSpace: 'pre',
  },
  output: {
    display: 'grid',
    gap: 'var(--spacing-2)',
    margin: 0,
    paddingInlineStart: 'var(--spacing-4)',
  },
});
