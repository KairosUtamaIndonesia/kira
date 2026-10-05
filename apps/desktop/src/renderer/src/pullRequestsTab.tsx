/**
 * The Pull requests view: the checkout repository's pull requests, read live
 * from its connected Git host.
 *
 * It is read-only on purpose — opening, editing, merging and marking ready stay
 * on the host, in a browser — so nothing here writes. A checkout with no remote,
 * a repository whose host is not connected, a host with no adapter and a host
 * that refuses each come back as a sentence rather than an empty list.
 *
 * Reads happen when the view is shown and when someone asks again, not on a
 * webhook or a realtime channel (docs/adr/0030).
 */
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { colorVars, spacingVars } from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { LivePullRequest, LivePullRequestDetail } from '../../preload/bridge';
import { DiffPatch } from './diffView';
import { checksWord, rowLabel, stateWord } from './pullRequestsModel';

export function PullRequestsTab({ chatId, visits }: { chatId: string; visits: number }) {
  const [pullRequests, setPullRequests] = useState<LivePullRequest[] | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<LivePullRequestDetail | null>(null);
  const [detailTrouble, setDetailTrouble] = useState<string | null>(null);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reading = useRef(0);

  useEffect(() => {
    if (visits === 0) return;
    const mine = (reading.current += 1);
    void window.kira.loadCheckoutPullRequests(chatId).then((answer) => {
      if (mine !== reading.current) return;
      if (answer.ok) {
        setPullRequests(answer.value);
        setTrouble(null);
      } else {
        setPullRequests(null);
        setTrouble(answer.error);
      }
    });
  }, [chatId, visits, tick]);

  useEffect(() => {
    if (selected === null) return;
    const mine = (reading.current += 1);
    void window.kira.loadCheckoutPullRequest(chatId, selected).then((answer) => {
      if (mine !== reading.current) return;
      if (answer.ok) {
        setDetail(answer.value);
        setDetailTrouble(null);
      } else {
        setDetail(null);
        setDetailTrouble(answer.error);
      }
    });
  }, [chatId, selected, tick]);

  function refresh(): void {
    setTick((count) => count + 1);
  }

  if (trouble !== null) {
    return (
      <VStack gap={2}>
        <Text type="supporting" color="secondary">
          {trouble}
        </Text>
        <div>
          <Button label="Try again" size="sm" variant="secondary" onClick={refresh} />
        </div>
      </VStack>
    );
  }

  if (selected !== null) {
    return (
      <div {...stylex.props(styles.tab)}>
        <HStack justify="between" align="center" gap={2}>
          <IconButton
            label="Back to the list"
            icon={<Icon icon={ArrowLeft} size="sm" />}
            onClick={() => {
              setSelected(null);
              setOpenFile(null);
            }}
          />
          <IconButton
            label="Refresh pull requests"
            icon={<Icon icon={RefreshCw} size="sm" />}
            onClick={refresh}
          />
        </HStack>
        {detailTrouble !== null ? (
          <Text type="supporting" color="secondary">
            {detailTrouble}
          </Text>
        ) : null}
        {detail !== null ? (
          <VStack gap={3}>
            <VStack gap={1}>
              <Text type="label">{rowLabel(detail.number, detail.title)}</Text>
              <Text type="supporting" color="secondary">
                {detailMeta(detail)}
              </Text>
            </VStack>
            {detail.body.trim() !== '' ? (
              <div {...stylex.props(styles.body)}>{detail.body}</div>
            ) : null}
            {detail.checks.length > 0 ? (
              <VStack gap={1}>
                <Text type="supporting" weight="medium">
                  Checks
                </Text>
                {detail.checks.map((check) => (
                  <HStack key={check.context} justify="between" gap={2}>
                    <Text type="supporting">{check.context}</Text>
                    <Text type="supporting" color="secondary">
                      {check.state}
                    </Text>
                  </HStack>
                ))}
              </VStack>
            ) : null}
            {detail.comments.length > 0 ? (
              <VStack gap={2}>
                <Text type="supporting" weight="medium">
                  Comments
                </Text>
                {detail.comments.map((comment, at) => (
                  <VStack key={at} gap={0.5}>
                    <Text type="supporting" color="secondary">
                      {comment.authorLogin ?? 'someone'}
                    </Text>
                    <div {...stylex.props(styles.body)}>{comment.body}</div>
                  </VStack>
                ))}
              </VStack>
            ) : null}
            {detail.files.length > 0 ? (
              <VStack gap={2}>
                <Text type="supporting" weight="medium">
                  Files
                </Text>
                {detail.files.map((file) => (
                  <VStack key={file.path} gap={1}>
                    <button
                      type="button"
                      {...stylex.props(styles.fileRow)}
                      onClick={() => setOpenFile((held) => (held === file.path ? null : file.path))}
                    >
                      <Text type="supporting">{file.path}</Text>
                      <Text type="supporting" color="secondary">
                        {file.status}
                      </Text>
                    </button>
                    {openFile === file.path ? (
                      file.patch === null ? (
                        <Text type="supporting" color="secondary">
                          This file has no diff to show.
                        </Text>
                      ) : (
                        <DiffPatch patch={file.patch} diffStyle="unified" wrap />
                      )
                    ) : null}
                  </VStack>
                ))}
              </VStack>
            ) : null}
          </VStack>
        ) : null}
      </div>
    );
  }

  if (pullRequests === null) return null;

  return (
    <div {...stylex.props(styles.tab)}>
      <HStack justify="between" align="center" gap={2}>
        <Text type="supporting" weight="medium">
          Pull requests
        </Text>
        <IconButton
          label="Refresh pull requests"
          icon={<Icon icon={RefreshCw} size="sm" />}
          onClick={refresh}
        />
      </HStack>
      {pullRequests.length === 0 ? (
        <Text type="supporting" color="secondary">
          This repository has no pull requests to show.
        </Text>
      ) : null}
      <VStack gap={1}>
        {pullRequests.map((request) => (
          <button
            key={request.number}
            type="button"
            {...stylex.props(styles.row)}
            onClick={() => {
              setSelected(request.number);
              setDetail(null);
              setOpenFile(null);
            }}
          >
            <Text type="label">{rowLabel(request.number, request.title)}</Text>
            <Text type="supporting" color="secondary">
              {metaOf(request)}
            </Text>
          </button>
        ))}
      </VStack>
    </div>
  );
}

/** The words beside a request: its state, its checks, who opened it and its branch. */
function metaOf(request: LivePullRequest): string {
  const parts = [stateWord(request.state)];
  const checks = checksWord(request.checksState);
  if (checks !== null) parts.push(checks);
  if (request.authorLogin !== null) parts.push(request.authorLogin);
  if (request.branch !== null) parts.push(request.branch);

  return parts.join(' · ');
}

/** The words above an opened request: its state, its author and where it lands. */
function detailMeta(detail: LivePullRequestDetail): string {
  const parts = [stateWord(detail.state)];
  if (detail.authorLogin !== null) parts.push(detail.authorLogin);
  if (detail.base !== null || detail.head !== null) {
    parts.push(`${detail.base ?? '?'} ← ${detail.head ?? '?'}`);
  }

  return parts.join(' · ');
}

const styles = stylex.create({
  tab: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-3'],
  },
  row: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-1'],
    width: '100%',
    borderWidth: 0,
    padding: spacingVars['--spacing-2'],
    borderRadius: 'var(--radius-inner)',
    backgroundColor: 'transparent',
    textAlign: 'start',
    cursor: 'pointer',
  },
  fileRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: spacingVars['--spacing-2'],
    width: '100%',
    borderWidth: 0,
    padding: spacingVars['--spacing-1'],
    borderRadius: 'var(--radius-inner)',
    backgroundColor: 'transparent',
    textAlign: 'start',
    cursor: 'pointer',
  },
  body: {
    whiteSpace: 'pre-wrap',
    color: colorVars['--color-text-primary'],
  },
});
