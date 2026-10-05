/**
 * The MCP servers this desktop makes available in global and workspace chats, in Settings.
 *
 * A grid of servers (`mcpGrid.tsx`), and a page for the one opened or being added.
 *
 * PROTOTYPE — this file holds the data and what can be done to it, and picks which layout draws
 * a server's page. Development builds flip between four with the bar at the foot of the window
 * (`?variant=`, or `[` and `]`), against the real servers, six made-up ones, or none (`?mcp=`).
 * Production always draws page A.
 */
import { useEffect, useState } from 'react';
import type {
  McpServer,
  McpServerDraft,
  McpToolSelection,
  Result,
  WorkspaceSummary,
} from '../../preload/bridge';
import type { McpModel } from './mcpModel';
import { liveSource, sampleServers, sampleSource, type McpSource } from './mcpSource';
import { ConfirmRemove } from './mcpForm';
import { McpGrid } from './mcpGrid';
import { McpPageA } from './mcpPageA';
import { McpPageB } from './mcpPageB';
import { McpPageC } from './mcpPageC';
import { McpPageD } from './mcpPageD';
import { PrototypeSwitcher } from './prototypeSwitcher';

function useMountEffect(effect: () => void | (() => void)): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(effect, []);
}

const VARIANTS = [
  { key: 'A', name: 'One page' },
  { key: 'B', name: 'Tabs' },
  { key: 'C', name: 'Form and panel' },
  { key: 'D', name: 'Edit in place' },
];

const DATA = [
  { key: 'live', name: 'Live' },
  { key: 'sample', name: 'Sample' },
  { key: 'empty', name: 'Empty' },
];

function readParam(key: string, allowed: { key: string }[], fallback: string): string {
  const asked = new URLSearchParams(window.location.search).get(key);
  return allowed.some((each) => each.key === asked) ? (asked as string) : fallback;
}

function writeParam(key: string, value: string): void {
  const params = new URLSearchParams(window.location.search);
  params.set(key, value);
  window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
}

export function McpSection({ workspaces }: { workspaces: readonly WorkspaceSummary[] }) {
  const [variant, setVariant] = useState(() =>
    import.meta.env.DEV ? readParam('variant', VARIANTS, 'A') : 'A',
  );
  const [data, setData] = useState(() =>
    import.meta.env.DEV ? readParam('mcp', DATA, 'live') : 'live',
  );
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <McpData
        key={data}
        data={data}
        variant={variant}
        workspaces={workspaces}
        onConfirming={setConfirming}
      />
      <PrototypeSwitcher
        lift={confirming}
        variants={VARIANTS}
        current={variant}
        onChange={(key) => {
          writeParam('variant', key);
          setVariant(key);
        }}
        options={{
          label: 'Data',
          choices: DATA,
          current: data,
          onChange: (key) => {
            writeParam('mcp', key);
            setConfirming(false);
            setData(key);
          },
        }}
      />
    </>
  );
}

function McpData({
  data,
  variant,
  workspaces,
  onConfirming,
}: {
  data: string;
  variant: string;
  workspaces: readonly WorkspaceSummary[];
  /** Tell the prototype bar a confirmation is open, so it can show above it. */
  onConfirming: (open: boolean) => void;
}) {
  const [source] = useState<McpSource>(() =>
    data === 'live'
      ? liveSource()
      : sampleSource(data === 'sample' ? sampleServers(workspaces) : []),
  );
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** The server whose page is open, 'new' for Add, or null for the grid. */
  const [page, setPage] = useState<string | null>(null);
  const [removing, setRemoving] = useState<McpServer | null>(null);

  useMountEffect(() => {
    let mounted = true;
    void source.load().then((result) => {
      if (!mounted) return;
      if (result.ok) setServers(result.value);
      else {
        setServers([]);
        setProblem(result.error);
      }
    });
    const stop = source.subscribe((next) => {
      if (mounted) setServers(next);
    });
    return () => {
      mounted = false;
      stop();
    };
  });

  /** Run a change, say what was refused, and report whether it went through. */
  async function run<T>(change: () => Promise<Result<T>>): Promise<Result<T>> {
    setBusy(true);
    setProblem(null);
    const result = await change();
    setBusy(false);
    if (!result.ok) setProblem(result.error);
    return result;
  }

  const model: McpModel = {
    servers,
    workspaces,
    busy,
    problem,
    clearProblem: () => setProblem(null),
    async save(id: string | null, draft: McpServerDraft) {
      const result = await run(() => (id === null ? source.add(draft) : source.update(id, draft)));
      if (!result.ok) return null;
      const saved = result.value;
      setServers((current) =>
        current === null || !current.some((each) => each.id === saved.id)
          ? [...(current ?? []), saved]
          : current.map((each) => (each.id === saved.id ? saved : each)),
      );
      return saved;
    },
    async remove(id: string) {
      const result = await run(() => source.remove(id));
      if (result.ok) setServers((current) => current?.filter((each) => each.id !== id) ?? null);
      return result.ok;
    },
    async reconnect(server: McpServer) {
      await run(() => source.reconnect(server.id));
    },
    async setEnabled(server: McpServer, enabled: boolean) {
      await run(() => source.setEnabled(server.id, enabled));
    },
    async setTools(server: McpServer, selection: McpToolSelection) {
      await run(() => source.setTools(server.id, selection));
    },
    async signIn(server: McpServer) {
      await run(() => source.signIn(server.id));
    },
    async signOut(server: McpServer) {
      await run(() => source.signOut(server.id));
    },
  };

  const open = page === 'new' ? 'new' : (servers?.find((each) => each.id === page) ?? null);
  const back = (): void => {
    setPage(null);
    model.clearProblem();
  };
  const Page =
    variant === 'B' ? McpPageB : variant === 'C' ? McpPageC : variant === 'D' ? McpPageD : McpPageA;

  if (open === null) {
    return <McpGrid model={model} onOpen={setPage} />;
  }

  return (
    <>
      <Page
        key={open === 'new' ? 'new' : open.id}
        model={model}
        server={open === 'new' ? null : open}
        onBack={back}
        onSaved={(saved) => setPage(saved.id)}
        onRemove={() => {
          if (open !== 'new') setRemoving(open);
          onConfirming(true);
        }}
      />
      {removing !== null && (
        <ConfirmRemove
          server={removing}
          model={model}
          onDone={(removed) => {
            setRemoving(null);
            onConfirming(false);
            if (removed) back();
          }}
        />
      )}
    </>
  );
}
