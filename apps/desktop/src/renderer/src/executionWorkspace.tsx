import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Divider } from '@astryxdesign/core/Divider';
import { Icon } from '@astryxdesign/core/Icon';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Text } from '@astryxdesign/core/Text';
import * as stylex from '@stylexjs/stylex';
import { ExternalLink, GitBranch, Laptop, Terminal } from 'lucide-react';
import { useEffect, useState } from 'react';
import type {
  ExecutionWorkspace,
  ExecutionReview,
  DeliveryAudit,
  DeliveryPath,
  Result,
  ExecutionCommandResult,
  ExecutionProcessSnapshot,
  ExecutionProcessEvent,
  Ticket,
  TicketSaid,
} from '../../preload/bridge.ts';
import {
  executionDiffFiles,
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
  onDeliver,
  onChanged,
}: {
  ticket: Ticket;
  workspaces: ExecutionWorkspace[];
  repository: string;
  onStart: (executionWorkspaceId: string, followUp?: string) => Promise<boolean>;
  onDeliver: (workspaceId: string, path: DeliveryPath) => Promise<Result<DeliveryAudit>>;
  onChanged: () => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState(workspaces[0]?.id ?? null);
  const selected = workspaces.find((workspace) => workspace.id === selectedId) ?? workspaces[0];
  const [creating, setCreating] = useState(false);
  const [starting, setStarting] = useState(false);

  const startWorkspace = async (id: string, followUp?: string): Promise<boolean> => {
    setStarting(true);
    try {
      return await onStart(id, followUp);
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

      <WorkspaceDetails
        key={selected.id}
        ticket={ticket}
        view={view}
        workspaceId={selected.id}
        onStart={(followUp) => startWorkspace(selected.id, followUp)}
        onDeliver={async (path) => {
          const answer = await onDeliver(selected.id, path);
          if (answer.ok && answer.value.outcome === 'delivered') await onChanged();
          return answer;
        }}
      />
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
  onStart,
  onDeliver,
}: {
  ticket: Ticket;
  view: ExecutionWorkspaceView;
  workspaceId: string;
  onStart: (followUp?: string) => Promise<boolean>;
  onDeliver: (path: DeliveryPath) => Promise<Result<DeliveryAudit>>;
}) {
  const [said, setSaid] = useState<TicketSaid[] | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [review, setReview] = useState<ExecutionReview | null>(null);
  const [commentTarget, setCommentTarget] = useState<{ path: string; line: number } | null>(null);
  const [comment, setComment] = useState('');
  const [feedback, setFeedback] = useState('');
  const [diff, setDiff] = useState<string | null>(null);
  const [sendingFeedback, setSendingFeedback] = useState(false);
  const [delivering, setDelivering] = useState(false);
  const [deliveryMessage, setDeliveryMessage] = useState<string | null>(null);
  const [command, setCommand] = useState('');
  const [commandResult, setCommandResult] = useState<ExecutionCommandResult | null>(null);
  const [runningCommand, setRunningCommand] = useState(false);
  const [devServerCommand, setDevServerCommand] = useState('npm run dev -- --host 127.0.0.1');
  const [server, setServer] = useState<ExecutionProcessSnapshot | null>(null);
  const [startingServer, setStartingServer] = useState(false);

  useMountEffect(() => {
    let receivedEvent = false;
    const unsubscribe = window.kira.onExecutionProcess((event: ExecutionProcessEvent) => {
      if (event.workspaceId !== workspaceId) return;
      receivedEvent = true;
      setServer(event);
    });
    void window.kira.readExecutionDevServer(ticket.id, workspaceId).then((answer) => {
      if (receivedEvent) return;
      if (answer.ok) setServer(answer.value);
      else setTrouble(answer.error);
    });
    return unsubscribe;
  });

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
    if (commentTarget === null) return;
    const answer = await window.kira.addReviewComment(ticket.id, workspaceId, {
      path: commentTarget.path,
      line: commentTarget.line,
      side: 'right',
      body: comment,
    });
    if (!answer.ok) {
      setTrouble(answer.error);
      return;
    }
    setComment('');
    setCommentTarget(null);
    await readReview();
  };

  const sendFeedback = async (): Promise<void> => {
    const followUp = feedback.trim();
    if (followUp === '') return;
    setSendingFeedback(true);
    try {
      const answer = await window.kira.sendReviewFeedback(ticket.id, workspaceId, {
        body: followUp,
      });
      if (!answer.ok) {
        setTrouble(answer.error);
        return;
      }
      if (await onStart(followUp)) setFeedback('');
      await readReview();
    } finally {
      setSendingFeedback(false);
    }
  };

  const deliver = async (path: DeliveryPath): Promise<void> => {
    setDelivering(true);
    setDeliveryMessage(null);
    try {
      const answer = await onDeliver(path);
      if (!answer.ok) {
        setTrouble(answer.error);
      } else if (answer.value.outcome === 'refused') {
        setDeliveryMessage(answer.value.details ?? 'Delivery was refused.');
      } else {
        setDeliveryMessage(
          path === 'local-merge'
            ? `Merged into ${answer.value.reference}.`
            : path === 'merge-pull-request'
              ? `Merged pull request ${answer.value.reference}.`
              : `Pull request created: ${answer.value.url ?? answer.value.reference}.`,
        );
      }
    } finally {
      setDelivering(false);
    }
  };

  const runCommand = async (): Promise<void> => {
    const input = command.trim();
    if (input === '') return;
    setRunningCommand(true);
    setTrouble(null);
    try {
      const answer = await window.kira.runExecutionCommand(ticket.id, workspaceId, input);
      if (!answer.ok) setTrouble(answer.error);
      else {
        setCommandResult(answer.value);
        setCommand('');
      }
    } finally {
      setRunningCommand(false);
    }
  };

  const readServer = async (): Promise<void> => {
    const answer = await window.kira.readExecutionDevServer(ticket.id, workspaceId);
    if (!answer.ok) setTrouble(answer.error);
    else setServer(answer.value);
  };

  const startServer = async (): Promise<void> => {
    setStartingServer(true);
    setTrouble(null);
    try {
      const answer = await window.kira.startExecutionDevServer(
        ticket.id,
        workspaceId,
        devServerCommand.trim(),
      );
      if (!answer.ok) setTrouble(answer.error);
      else {
        setServer(answer.value);
      }
    } finally {
      setStartingServer(false);
    }
  };

  const stopServer = async (): Promise<void> => {
    const answer = await window.kira.stopExecutionDevServer(ticket.id, workspaceId);
    if (!answer.ok) setTrouble(answer.error);
    else setServer(answer.value);
  };

  const changedFiles = diff === null ? [] : executionDiffFiles(diff);

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
        <div {...stylex.props(styles.commandForm)}>
          <TextInput
            label="Run a command in this checkout"
            value={command}
            onChange={setCommand}
            size="sm"
            onKeyDown={(event) => {
              if (event.key === 'Enter') void runCommand();
            }}
          />
          <Button
            label={runningCommand ? 'Command running…' : 'Run command'}
            size="sm"
            variant="secondary"
            isDisabled={runningCommand || command.trim() === ''}
            onClick={() => void runCommand()}
          />
        </div>
        {commandResult !== null && (
          <div {...stylex.props(styles.commandResult)} aria-live="polite">
            <Text type="code">
              $ {commandResult.command} · exit {commandResult.exitCode}
            </Text>
            <pre>{commandResult.output || '(no output)'}</pre>
          </div>
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
        {commentTarget !== null && (
          <div {...stylex.props(styles.form)}>
            <Text type="supporting" color="secondary">
              Comment on {commentTarget.path}:{commentTarget.line}
            </Text>
            <TextArea label="Inline comment" value={comment} onChange={setComment} rows={3} />
            <div {...stylex.props(styles.choices)}>
              <Button
                label="Add comment"
                size="sm"
                variant="secondary"
                isDisabled={comment.trim() === ''}
                onClick={() => void addComment()}
              />
              <Button
                label="Cancel comment"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setCommentTarget(null);
                  setComment('');
                }}
              />
            </div>
          </div>
        )}
        <TextArea label="Feedback for the agent" value={feedback} onChange={setFeedback} rows={3} />
        <Button
          label={view.status === 'running' ? 'Agent is running' : 'Send feedback & run agent'}
          size="sm"
          variant="primary"
          isDisabled={
            feedback.trim() === '' ||
            sendingFeedback ||
            ticket.band !== 'ready' ||
            view.status === 'running'
          }
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
            <div {...stylex.props(styles.diff)}>
              {changedFiles.map((file) => (
                <section key={file.path} {...stylex.props(styles.diffFile)} aria-label={file.path}>
                  <Text type="code">{file.path}</Text>
                  {file.lines.map((line, index) => (
                    <div
                      key={`${index}:${line.kind}`}
                      {...stylex.props(
                        styles.diffLine,
                        line.kind === 'added' && styles.diffAdded,
                        line.kind === 'removed' && styles.diffRemoved,
                        line.kind === 'hunk' && styles.diffHunk,
                      )}
                    >
                      <span {...stylex.props(styles.diffNumber)}>{line.oldLine ?? ''}</span>
                      <span {...stylex.props(styles.diffNumber)}>{line.newLine ?? ''}</span>
                      <code {...stylex.props(styles.diffText)}>{line.text || ' '}</code>
                      {(line.kind === 'added' || line.kind === 'context') &&
                        line.newLine !== null && (
                          <Button
                            label={`Comment on line ${line.newLine}`}
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setCommentTarget({ path: file.path, line: line.newLine! })
                            }
                          />
                        )}
                    </div>
                  ))}
                </section>
              ))}
            </div>
          ))}
      </div>

      <div {...stylex.props(styles.block)}>
        <div {...stylex.props(styles.blockHeading)}>
          <Icon icon={ExternalLink} size="sm" />
          <Text type="label" weight="medium">
            Development preview
          </Text>
          <Button
            label="Refresh process"
            size="sm"
            variant="ghost"
            onClick={() => void readServer()}
          />
        </div>
        <Text type="supporting" color="secondary">
          {executionPreviewLabel(server?.previewUrl ? { url: server.previewUrl } : view.preview)}
        </Text>
        {server?.running ? (
          <Button
            label="Stop development server"
            size="sm"
            variant="secondary"
            onClick={() => void stopServer()}
          />
        ) : (
          <div {...stylex.props(styles.commandForm)}>
            <TextInput
              label="Development server command"
              value={devServerCommand}
              onChange={setDevServerCommand}
              size="sm"
            />
            <Button
              label={startingServer ? 'Starting…' : 'Start server'}
              size="sm"
              variant="primary"
              isDisabled={startingServer || devServerCommand.trim() === ''}
              onClick={() => void startServer()}
            />
          </div>
        )}
        {server !== null && server.output !== '' && (
          <pre {...stylex.props(styles.processLog)} aria-live="polite">
            {server.output}
          </pre>
        )}
        {server?.previewUrl !== null && server?.previewUrl !== undefined && (
          <iframe
            title="Execution workspace development preview"
            src={server.previewUrl}
            sandbox="allow-scripts allow-forms"
            referrerPolicy="no-referrer"
            {...stylex.props(styles.previewFrame)}
          />
        )}
      </div>

      {view.run?.verdict === 'accepted' && ticket.band !== 'done' && (
        <div {...stylex.props(styles.block)}>
          <Text type="label" weight="medium">
            Deliver approved work
          </Text>
          <div {...stylex.props(styles.choices)}>
            <Button
              label="Merge locally"
              size="sm"
              variant="secondary"
              isDisabled={delivering}
              onClick={() => void deliver('local-merge')}
            />
            <Button
              label="Create pull request"
              size="sm"
              variant="primary"
              isDisabled={delivering}
              onClick={() => void deliver('pull-request')}
            />
            <Button
              label="Merge pull request"
              size="sm"
              variant="secondary"
              isDisabled={delivering}
              onClick={() => void deliver('merge-pull-request')}
            />
          </div>
          {deliveryMessage !== null && (
            <Text type="supporting" color="secondary">
              {deliveryMessage}
            </Text>
          )}
        </div>
      )}
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
  commandForm: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    alignItems: 'end',
    gap: 'var(--spacing-2)',
  },
  commandResult: { display: 'grid', gap: 'var(--spacing-2)', minWidth: 0 },
  processLog: {
    maxHeight: 240,
    overflow: 'auto',
    margin: 0,
    padding: 'var(--spacing-3)',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--color-background-muted)',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    fontFamily: 'var(--font-family-mono)',
    fontSize: 'var(--font-size-sm)',
  },
  previewFrame: {
    width: '100%',
    minHeight: 440,
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'white',
  },
  reviewItem: { display: 'grid', gap: 'var(--spacing-1)', paddingBlock: 'var(--spacing-2)' },
  diff: {
    display: 'grid',
    gap: 'var(--spacing-3)',
    overflow: 'auto',
    maxHeight: 480,
    padding: 'var(--spacing-3)',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--color-background-muted)',
    fontFamily: 'var(--font-family-mono)',
    fontSize: 'var(--font-size-sm)',
  },
  diffFile: { display: 'grid', gap: 'var(--spacing-1)', minWidth: 'max-content' },
  diffLine: {
    display: 'grid',
    gridTemplateColumns: '3em 3em minmax(0, 1fr) auto',
    alignItems: 'center',
    gap: 'var(--spacing-1)',
    minHeight: 28,
    whiteSpace: 'pre',
  },
  diffNumber: { color: 'var(--color-text-secondary)', textAlign: 'end' },
  diffText: { whiteSpace: 'pre' },
  diffAdded: { backgroundColor: 'var(--color-background-success-subtle)' },
  diffRemoved: { backgroundColor: 'var(--color-background-danger-subtle)' },
  diffHunk: { color: 'var(--color-text-secondary)' },
  output: {
    display: 'grid',
    gap: 'var(--spacing-2)',
    margin: 0,
    paddingInlineStart: 'var(--spacing-4)',
  },
});

function useMountEffect(effect: () => void | (() => void)): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(effect, []);
}
