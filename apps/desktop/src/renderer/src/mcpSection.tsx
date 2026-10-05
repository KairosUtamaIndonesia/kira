/**
 * The MCP servers this desktop makes available in global and workspace chats, in Settings.
 *
 * PROTOTYPE — this file holds the data and what can be done to it, and picks which layout draws
 * it. Development builds flip between three layouts with the bar at the foot of the window
 * (`?variant=`, or `[` and `]`), against the real servers, six made-up ones, or none (`?mcp=`).
 * Production always draws variant A.
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
import { McpVariantA } from './mcpVariantA';
import { McpVariantB } from './mcpVariantB';
import { McpVariantC } from './mcpVariantC';
import { PrototypeSwitcher } from './prototypeSwitcher';

function useMountEffect(effect: () => void | (() => void)): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(effect, []);
}

const VARIANTS = [
  { key: 'A', name: 'Ledger and dialog' },
  { key: 'B', name: 'List and detail' },
  { key: 'C', name: 'Tiles and page' },
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

export interface VariantProps {
  model: McpModel;
  /** Tell the prototype bar a modal dialog is open, so it can show above it. */
  onModal: (open: boolean) => void;
}

export function McpSection({ workspaces }: { workspaces: readonly WorkspaceSummary[] }) {
  const [variant, setVariant] = useState(() =>
    import.meta.env.DEV ? readParam('variant', VARIANTS, 'A') : 'A',
  );
  const [data, setData] = useState(() =>
    import.meta.env.DEV ? readParam('mcp', DATA, 'live') : 'live',
  );
  const [modal, setModal] = useState(false);

  return (
    <>
      <McpData
        key={data}
        data={data}
        variant={variant}
        workspaces={workspaces}
        onModal={setModal}
      />
      <PrototypeSwitcher
        lift={modal}
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
            setModal(false);
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
  onModal,
}: {
  data: string;
  variant: string;
  workspaces: readonly WorkspaceSummary[];
  onModal: (open: boolean) => void;
}) {
  const [source] = useState<McpSource>(() =>
    data === 'live'
      ? liveSource()
      : sampleSource(data === 'sample' ? sampleServers(workspaces) : []),
  );
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

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

  const props = { model, onModal };
  return variant === 'B' ? (
    <McpVariantB {...props} />
  ) : variant === 'C' ? (
    <McpVariantC {...props} />
  ) : (
    <McpVariantA {...props} />
  );
}
