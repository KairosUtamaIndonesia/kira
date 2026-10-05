/**
 * The MCP servers this desktop makes available in global and workspace chats, in Settings.
 *
 * This file holds the servers and what can be done to them; `mcpGrid.tsx` draws the grid of
 * them and `mcpPage.tsx` the page of the one opened or being added. A server's credentials are
 * write-only: the main process never sends them back, so nothing here ever holds one.
 */
import { useEffect, useState } from 'react';
import type {
  McpServer,
  McpServerDraft,
  McpToolSelection,
  Result,
  WorkspaceSummary,
} from '../../preload/bridge';
import { ConfirmRemove } from './mcpForm';
import { McpGrid } from './mcpGrid';
import type { McpModel } from './mcpModel';
import { McpPage } from './mcpPage';

function useMountEffect(effect: () => void | (() => void)): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(effect, []);
}

export function McpSection({ workspaces }: { workspaces: readonly WorkspaceSummary[] }) {
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** The server whose page is open, 'new' for Add, or null for the grid. */
  const [page, setPage] = useState<string | null>(null);
  const [removing, setRemoving] = useState<McpServer | null>(null);

  useMountEffect(() => {
    let mounted = true;
    void window.kira.loadMcpServers().then((result) => {
      if (!mounted) return;
      if (result.ok) {
        setServers(result.value);
      } else {
        setServers([]);
        setProblem(result.error);
      }
    });
    const stop = window.kira.onMcpEvent((next) => {
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
      const result = await run(() =>
        id === null ? window.kira.addMcpServer(draft) : window.kira.updateMcpServer(id, draft),
      );
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
      const result = await run(() => window.kira.removeMcpServer(id));
      if (result.ok) setServers((current) => current?.filter((each) => each.id !== id) ?? null);
      return result.ok;
    },
    async reconnect(server: McpServer) {
      await run(() => window.kira.reconnectMcpServer(server.id));
    },
    async setEnabled(server: McpServer, enabled: boolean) {
      await run(() => window.kira.setMcpServerEnabled(server.id, enabled));
    },
    async setTools(server: McpServer, selection: McpToolSelection) {
      await run(() => window.kira.setMcpServerToolSelection(server.id, selection));
    },
    async signIn(server: McpServer) {
      await run(() => window.kira.signInMcpServer(server.id));
    },
    async signOut(server: McpServer) {
      await run(() => window.kira.signOutMcpServer(server.id));
    },
  };

  const open = page === 'new' ? 'new' : (servers?.find((each) => each.id === page) ?? null);
  const back = (): void => {
    setPage(null);
    model.clearProblem();
  };

  if (open === null) {
    return <McpGrid model={model} onOpen={setPage} />;
  }

  return (
    <>
      <McpPage
        key={open === 'new' ? 'new' : open.id}
        model={model}
        server={open === 'new' ? null : open}
        onBack={back}
        onSaved={(saved) => setPage(saved.id)}
        onRemove={() => {
          if (open !== 'new') setRemoving(open);
        }}
      />
      {removing !== null && (
        <ConfirmRemove
          server={removing}
          model={model}
          onDone={(removed) => {
            setRemoving(null);
            if (removed) back();
          }}
        />
      )}
    </>
  );
}
