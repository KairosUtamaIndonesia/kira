/**
 * The Pull requests view: the checkout repository's pull requests, read live
 * from its connected Git host.
 *
 * It is read-only on purpose — opening, editing, merging and marking ready stay
 * on the host, in a browser — so nothing here writes. A checkout with no remote,
 * a repository whose host is not connected, a host with no adapter and a host
 * that refuses each come back as a sentence rather than an empty list.
 *
 * It is shaped like the Changes view: a list that is only an index, and a
 * request opened into the whole pane, with a file's diff one step further in.
 *
 * Reads happen when the view is shown and when someone asks again, not on a
 * webhook or a realtime channel (docs/adr/0030).
 */
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { spacingVars } from '@astryxdesign/core/theme/tokens.stylex';
import * as stylex from '@stylexjs/stylex';
import { RefreshCw, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type {
  LivePullRequest,
  LivePullRequestDetail,
  PullRequestState,
} from '../../preload/bridge';
import type { DiffStyle } from './diffView';
import { PullRequestFileScreen, PullRequestScreen, type Section } from './pullRequestDetail';
import { PullRequestRows } from './pullRequestsList';
import { visibleRequests } from './pullRequestsModel';

export function PullRequestsTab({ chatId, visits }: { chatId: string; visits: number }) {
  const [pullRequests, setPullRequests] = useState<LivePullRequest[] | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [selected, setSelected] = useState<LivePullRequest | null>(null);
  const [detail, setDetail] = useState<LivePullRequestDetail | null>(null);
  const [detailTrouble, setDetailTrouble] = useState<string | null>(null);
  const [section, setSection] = useState<Section>('about');
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [diffStyle, setDiffStyle] = useState<DiffStyle>('unified');
  const [wrap, setWrap] = useState(true);
  const [state, setState] = useState<PullRequestState>('open');
  const [query, setQuery] = useState('');
  const [tick, setTick] = useState(0);
  const listReading = useRef(0);
  const detailReading = useRef(0);

  useEffect(() => {
    if (visits === 0) return;
    const mine = (listReading.current += 1);
    void window.kira.loadCheckoutPullRequests(chatId, state).then((answer) => {
      if (mine !== listReading.current) return;
      if (answer.ok) {
        setPullRequests(answer.value);
        setTrouble(null);
      } else {
        setPullRequests(null);
        setTrouble(answer.error);
      }
    });
  }, [chatId, visits, tick, state]);

  const selectedNumber = selected?.number ?? null;
  useEffect(() => {
    if (selectedNumber === null) return;
    const mine = (detailReading.current += 1);
    void window.kira.loadCheckoutPullRequest(chatId, selectedNumber).then((answer) => {
      if (mine !== detailReading.current) return;
      if (answer.ok) {
        setDetail(answer.value);
        setDetailTrouble(null);
      } else {
        setDetail(null);
        setDetailTrouble(answer.error);
      }
    });
  }, [chatId, selectedNumber, tick]);

  function refresh(): void {
    setTick((count) => count + 1);
  }

  function open(number: number): void {
    const request = pullRequests?.find((each) => each.number === number);
    if (request === undefined) return;
    setSelected(request);
    setDetail(null);
    setDetailTrouble(null);
    setSection('about');
    setOpenFile(null);
  }

  const files = detail?.files ?? [];
  function move(by: number): void {
    const at = files.findIndex((file) => file.path === openFile);
    const next = files[at + by];
    if (at !== -1 && next !== undefined) setOpenFile(next.path);
  }

  const keys = useRef(move);
  useEffect(() => {
    keys.current = move;
  });
  const isReadingFile = openFile !== null;
  useEffect(() => {
    if (!isReadingFile) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (
        (event.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable]')
      ) {
        return;
      }
      if (event.key === 'j') keys.current(1);
      else if (event.key === 'k') keys.current(-1);
    };
    window.addEventListener('keydown', onKey);

    return () => window.removeEventListener('keydown', onKey);
  }, [isReadingFile]);

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

  if (selected !== null && openFile !== null && detail !== null) {
    return (
      <PullRequestFileScreen
        key={openFile}
        files={detail.files}
        path={openFile}
        diffStyle={diffStyle}
        wrap={wrap}
        onBack={() => setOpenFile(null)}
        onMove={move}
        onDiffStyle={setDiffStyle}
        onWrap={setWrap}
      />
    );
  }

  if (selected !== null) {
    return (
      <PullRequestScreen
        request={selected}
        detail={detail}
        trouble={detailTrouble}
        section={section}
        onSection={setSection}
        onBack={() => setSelected(null)}
        onRefresh={refresh}
        onOpenFile={setOpenFile}
      />
    );
  }

  const visible = visibleRequests(pullRequests ?? [], query);
  const loading = pullRequests === null;

  return (
    <div {...stylex.props(styles.tab)}>
      <SegmentedControl
        label="Which pull requests"
        value={state}
        onChange={(next) => setState(next as PullRequestState)}
        size="sm"
        layout="fill"
      >
        <SegmentedControlItem value="open" label="Open" />
        <SegmentedControlItem value="closed" label="Closed" />
        <SegmentedControlItem value="all" label="All" />
      </SegmentedControl>
      <div {...stylex.props(styles.searchRow)}>
        <div {...stylex.props(styles.searchBox)}>
          <TextInput
            label="Search pull requests"
            isLabelHidden
            placeholder="Search"
            size="sm"
            startIcon={Search}
            hasClear
            width="100%"
            value={query}
            onChange={setQuery}
          />
        </div>
        <IconButton
          label="Refresh pull requests"
          icon={<Icon icon={RefreshCw} size="sm" />}
          onClick={refresh}
        />
      </div>
      {loading && (
        <Text type="supporting" color="secondary">
          Reading pull requests…
        </Text>
      )}
      {!loading && visible.length === 0 && (
        <Text type="supporting" color="secondary">
          {query.trim() === ''
            ? state === 'open'
              ? 'No pull request is open.'
              : 'This repository has no pull requests to show.'
            : 'No pull request matches that search.'}
        </Text>
      )}
      <PullRequestRows requests={visible} onOpen={open} />
    </div>
  );
}

const styles = stylex.create({
  tab: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-3'],
  },
  searchRow: {
    display: 'flex',
    alignItems: 'center',
    gap: spacingVars['--spacing-1'],
  },
  searchBox: { flex: 1, minWidth: 0 },
});
