import {
  Client,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  type AuthProvider,
  type CallToolResult,
  type OAuthClientProvider,
  type Tool as McpTool,
  type Transport,
} from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import type {
  McpServerDraft,
  McpServerRecord,
  McpServerTransport,
  McpToolSelection,
  ThreadStore,
} from '../db/threads.ts';
import type { McpSecretSnapshot, McpSecretStore } from './secrets.ts';
import type { McpOAuth } from './authorization.ts';
import { resolveCommand } from './command.ts';

export type CommandResolver = (command: string) => string;

export type McpServerStatus = 'not-started' | 'connecting' | 'connected' | 'failed' | 'disabled' | 'needs-sign-in';

export interface McpToolBinding {
  name: string;
  serverId: string;
  serverName: string;
  toolName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  selected: boolean;
}

export interface McpServerSnapshot extends McpServerRecord {
  status: McpServerStatus;
  error: string | null;
  tools: McpToolBinding[];
  hasCredentials: boolean;
  credentialsPersisted: boolean;
  hasOAuth: boolean;
  oauthCredentialsPersisted: boolean;
}

export interface McpManager {
  start(): Promise<void>;
  add(draft: McpServerDraft): Promise<McpServerSnapshot>;
  update(id: string, draft: McpServerDraft): Promise<McpServerSnapshot>;
  remove(id: string): Promise<void>;
  reconnect(id: string): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  setToolSelection(id: string, selection: McpToolSelection): Promise<void>;
  signIn(id: string): Promise<void>;
  signOut(id: string): Promise<void>;
  connect(id: string): Promise<void>;
  connectWorkspace(workspaceId: string): Promise<void>;
  forgetWorkspace(workspaceId: string): Promise<void>;
  snapshot(id: string): McpServerSnapshot | undefined;
  snapshots(): McpServerSnapshot[];
  tools(workspaceId?: string | null): McpToolBinding[];
  callTool(
    name: string,
    arguments_: Record<string, unknown>,
    signal?: AbortSignal,
    workspaceId?: string | null,
  ): Promise<CallToolResult>;
  subscribe(listener: () => void): () => void;
  close(): Promise<void>;
}

interface ConnectedServer {
  snapshot: McpServerSnapshot;
  allTools: McpTool[];
  client?: Client;
  transport?: Transport;
  connecting?: Promise<void>;
  removing: boolean;
}

/**
 * The one MCP connection owner for the desktop.
 *
 * Pi sessions only receive the selected tools this manager has discovered.
 * Keeping the process here means two open chats do not spawn two copies of one
 * server, and Settings sees the same connection that a chat calls.
 */
export function mcpManager({
  store,
  secrets,
  oauth,
  commandResolver = resolveCommand,
}: {
  store: ThreadStore;
  secrets?: McpSecretStore;
  oauth?: McpOAuth;
  commandResolver?: CommandResolver;
}): McpManager {
  const servers = new Map<string, ConnectedServer>();
  const activeWorkspaces = new Set<string>();
  const listeners = new Set<() => void>();
  let started = false;
  let closing = false;
  let startup: Promise<void> | undefined;
  let registered: Promise<void> | undefined;
  let shutdown: Promise<void> | undefined;
  let secretsLoaded: Promise<void> | undefined;

  function notify(): void {
    for (const listener of listeners) listener();
  }

  function loadSecrets(): Promise<void> {
    secretsLoaded ??= secrets?.load() ?? Promise.resolve();
    return secretsLoaded;
  }

  function stateFor(record: McpServerRecord): ConnectedServer {
    const state: ConnectedServer = {
      snapshot: {
        ...record,
        status: record.enabled ? 'not-started' : 'disabled',
        error: null,
        tools: [],
        hasCredentials: secrets?.has(record.id) ?? false,
        credentialsPersisted: secrets?.persisted(record.id) ?? false,
        hasOAuth: secrets?.hasOAuth(record.id) ?? false,
        oauthCredentialsPersisted: secrets?.persistedOAuth(record.id) ?? false,
      },
      allTools: [],
      removing: false,
    };
    servers.set(record.id, state);
    return state;
  }

  function selected(toolName: string, selection: McpToolSelection): boolean {
    return selection === 'all' || selection.includes(toolName);
  }

  function bindingsFor(record: McpServerRecord, tools: readonly McpTool[]): McpToolBinding[] {
    return tools.map((tool) => ({
      name: `${record.name}_${tool.name}`,
      serverId: record.id,
      serverName: record.name,
      toolName: tool.name,
      description: tool.description ?? `Use ${tool.name} from ${record.name}.`,
      inputSchema: tool.inputSchema as Record<string, unknown>,
      selected: selected(tool.name, record.toolSelection),
    }));
  }

  function setTools(state: ConnectedServer, tools: readonly McpTool[]): void {
    state.allTools = [...tools];
    state.snapshot.tools = bindingsFor(state.snapshot, state.allTools);
  }

  /** Choose workspace servers over same-named global servers for one chat. */
  function visibleTools(workspaceId: string | null): Map<string, McpToolBinding> {
    const chosen = new Map<string, ConnectedServer>();
    for (const state of servers.values()) {
      if (state.snapshot.scope === 'global') {
        chosen.set(state.snapshot.name, state);
      }
    }
    if (workspaceId !== null) {
      for (const state of servers.values()) {
        if (
          state.snapshot.scope === 'workspace'
          && state.snapshot.workspaceId === workspaceId
        ) {
          chosen.set(state.snapshot.name, state);
        }
      }
    }

    const tools = new Map<string, McpToolBinding>();
    for (const state of chosen.values()) {
      for (const tool of state.snapshot.tools) tools.set(tool.name, tool);
    }
    return tools;
  }

  function failureMessage(error: unknown, record: McpServerRecord): string {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('ENOENT') || message.includes('spawn ' + record.command)) {
      return `Command not found: ${record.command}`;
    }
    return message;
  }

  async function closeState(state: ConnectedServer): Promise<void> {
    state.removing = true;
    state.allTools = [];
    state.snapshot.tools = [];
    const client = state.client;
    const transport = state.transport;
    state.client = undefined;
    state.transport = undefined;
    if (client !== undefined) {
      await client.close().catch(() => undefined);
    } else if (transport !== undefined) {
      await transport.close().catch(() => undefined);
    }
  }

  async function connectNow(id: string): Promise<void> {
    const state = servers.get(id);
    if (state === undefined || state.removing) return;

    const record = store.findMcpServer(id);
    if (record === undefined) return;
    const serverCredentials = secrets?.read(id);
    state.snapshot = {
      ...record,
      status: record.enabled ? 'connecting' : 'disabled',
      error: null,
      tools: [],
      hasCredentials: secrets?.has(id) ?? false,
      credentialsPersisted: secrets?.persisted(id) ?? false,
      hasOAuth: secrets?.hasOAuth(id) ?? false,
      oauthCredentialsPersisted: secrets?.persistedOAuth(id) ?? false,
    };
    state.allTools = [];
    if (!record.enabled) {
      notify();
      return;
    }
    notify();

    const failed = (error: unknown): void => {
      if (closing || state.removing || servers.get(id) !== state) return;
      if (
        state.snapshot.status === 'needs-sign-in'
        || (state.snapshot.status === 'failed' && state.snapshot.error !== null)
      ) return;
      if (error instanceof UnauthorizedError && record.transport === 'streamable-http') {
        state.snapshot.status = 'needs-sign-in';
        state.snapshot.error = null;
      } else {
        state.snapshot.status = 'failed';
        state.snapshot.error = failureMessage(error, record);
      }
      state.snapshot.hasOAuth = secrets?.hasOAuth(id) ?? false;
      state.snapshot.oauthCredentialsPersisted = secrets?.persistedOAuth(id) ?? false;
      state.allTools = [];
      state.snapshot.tools = [];
      notify();
    };

    let client: Client;
    client = new Client(
      { name: 'kira', version: '0.1.0' },
      {
        listChanged: {
          tools: {
            onChanged: (error, tools) => {
              if (error !== null) {
                failed(error);
                return;
              }
              if (tools === null || state.removing || servers.get(id) !== state) return;
              setTools(state, tools);
              notify();
            },
          },
        },
      },
    );

    let transport: Transport;
    try {
      if (record.transport === 'streamable-http') {
        if (record.url === null) throw new Error('MCP server URL is missing.');
        const headers = new Headers(serverCredentials?.headers);
        if (serverCredentials?.bearerToken !== undefined) {
          headers.set('Authorization', `Bearer ${serverCredentials.bearerToken}`);
        }
        const authProvider: AuthProvider | OAuthClientProvider | undefined = oauth === undefined
          ? undefined
          : secrets?.hasOAuth(id) === true
            ? oauth.provider(id)
            : {
                token: async () => undefined,
                onUnauthorized: async () => { throw new UnauthorizedError(); },
              };
        transport = new StreamableHTTPClientTransport(new URL(record.url), {
          requestInit: { headers },
          ...(authProvider === undefined ? {} : { authProvider }),
        });
      } else {
        const command = commandResolver(record.command);
        transport = new StdioClientTransport({
          command,
          args: record.args,
          cwd: record.cwd ?? undefined,
          env: {
            ...Object.fromEntries(
              Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
            ),
            ...serverCredentials?.env,
          },
        });
      }
    } catch (error) {
      failed(error);
      return;
    }

    state.client = client;
    state.transport = transport;
    transport.onerror = failed;
    transport.onclose = () => failed(new Error('The MCP server closed its connection.'));
    client.onerror = failed;
    client.onclose = () => failed(new Error('The MCP server closed its connection.'));

    try {
      await client.connect(transport);
      const listed = await client.listTools();
      if (state.removing || servers.get(id) !== state) return;
      setTools(state, listed.tools);
      state.snapshot.status = 'connected';
      state.snapshot.error = null;
      state.snapshot.hasOAuth = secrets?.hasOAuth(id) ?? false;
      state.snapshot.oauthCredentialsPersisted = secrets?.persistedOAuth(id) ?? false;
      notify();
    } catch (error) {
      failed(error);
      await client.close().catch(() => undefined);
    }
  }

  function connect(id: string): Promise<void> {
    const state = servers.get(id);
    if (state === undefined || state.removing) return Promise.resolve();
    if (state.connecting !== undefined) return state.connecting;

    const attempt = connectNow(id).finally(() => {
      state.connecting = undefined;
    });
    state.connecting = attempt;
    return attempt;
  }

  function shouldConnect(record: McpServerRecord): boolean {
    return record.enabled && (
      record.scope === 'global'
      || (record.workspaceId !== null && activeWorkspaces.has(record.workspaceId))
    );
  }

  async function replaceAndConnect(id: string, record: McpServerRecord): Promise<void> {
    const old = servers.get(id);
    if (old !== undefined) await closeState(old);
    const next = stateFor(record);
    notify();
    if (started && shouldConnect(record)) await connect(next.snapshot.id);
  }

  async function reconnect(id: string): Promise<void> {
    const record = store.findMcpServer(id);
    if (record === undefined) throw new Error('That MCP server does not exist.');
    await replaceAndConnect(id, record);
  }

  function start(): Promise<void> {
    if (started) return startup ?? Promise.resolve();
    started = true;
    registered = (async () => {
      if (closing) return;
      await loadSecrets();
      if (closing) return;
      for (const record of store.listMcpServers()) stateFor(record);
      notify();
    })();
    startup = (async () => {
      await registered;
      if (closing) return;
      await Promise.all(
        [...servers.values()]
          .filter((state) => state.snapshot.scope === 'global')
          .map((state) => connect(state.snapshot.id)),
      );
    })();
    return startup;
  }

  return {
    start,

    async add(draft) {
      await loadSecrets();
      if (started) await registered;
      const record = store.createMcpServer(draft);
      try {
        await secrets?.update(record.id, draft.credentials ?? {});
      } catch (error) {
        try {
          await secrets?.forget(record.id);
        } finally {
          store.deleteMcpServer(record.id);
        }
        throw error;
      }
      const state = stateFor(record);
      notify();
      if (started && shouldConnect(record)) await connect(record.id);
      return state.snapshot;
    },

    async update(id, draft) {
      await loadSecrets();
      if (started) await registered;
      const previous = store.findMcpServer(id);
      if (previous === undefined) throw new Error('That MCP server does not exist.');
      const transport = draft.transport ?? 'stdio';
      // Mirrors pi-mcp-adapter's endpoint-bound credential invalidation rule
      // (MIT, Copyright (c) 2026 Nico Bailon; full notice in command.ts).
      const identityChanged = previous.transport !== transport
        || (transport === 'stdio' && (
          previous.command !== draft.command
          || JSON.stringify(previous.args) !== JSON.stringify(draft.args)
          || previous.cwd !== draft.cwd
        ))
        || (transport === 'streamable-http' && previous.url !== draft.url);
      const previousSecrets: McpSecretSnapshot | undefined = identityChanged || draft.credentials !== undefined
        ? await secrets?.snapshot(id)
        : undefined;
      const previousState = identityChanged ? servers.get(id) : undefined;
      if (identityChanged) {
        oauth?.invalidate(id);
        if (previousState !== undefined) await closeState(previousState);
        await secrets?.forget(id);
      }
      let record: McpServerRecord | undefined;
      try {
        record = store.updateMcpServer(id, draft);
        if (record === undefined) throw new Error('That MCP server does not exist.');
        if (draft.credentials !== undefined) await secrets?.update(id, draft.credentials);
      } catch (error) {
        const rollbackErrors: unknown[] = [];
        if (record !== undefined) {
          try {
            store.updateMcpServer(id, previous);
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError);
          }
        }
        if (previousSecrets !== undefined) {
          try {
            await secrets?.restore(id, previousSecrets);
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError);
          }
        }
        if (identityChanged && previousState !== undefined) {
          try {
            await replaceAndConnect(id, previous);
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError);
          }
        }
        if (rollbackErrors.length > 0) {
          throw new AggregateError(
            [error, ...rollbackErrors],
            'The server edit failed and could not be fully rolled back.',
          );
        }
        throw error;
      }
      await replaceAndConnect(id, record);
      return servers.get(id)?.snapshot ?? recordSnapshot(record);
    },

    async remove(id) {
      await loadSecrets();
      if (started) await registered;
      if (store.findMcpServer(id) === undefined) throw new Error('That MCP server does not exist.');
      const state = servers.get(id);
      const previousSecrets = await secrets?.snapshot(id);
      oauth?.invalidate(id);
      if (state !== undefined) state.removing = true;

      try {
        if (state !== undefined) await closeState(state);
        await secrets?.forget(id);
        store.deleteMcpServer(id);
      } catch (error) {
        let rollbackError: unknown;
        if (previousSecrets !== undefined) {
          try {
            await secrets?.restore(id, previousSecrets);
          } catch (failure) {
            rollbackError = failure;
          }
        }
        if (state !== undefined) {
          const record = store.findMcpServer(id);
          if (record !== undefined) {
            try {
              await replaceAndConnect(id, record);
            } catch (failure) {
              rollbackError ??= failure;
            }
          }
        }
        if (rollbackError !== undefined) {
          throw new AggregateError(
            [error, rollbackError],
            'The server removal failed and its credentials could not be restored.',
          );
        }
        throw error;
      }

      if (state !== undefined) {
        servers.delete(id);
        notify();
      }
    },

    reconnect,

    async signIn(id) {
      await loadSecrets();
      const record = store.findMcpServer(id);
      if (record === undefined) throw new Error('That MCP server does not exist.');
      if (!record.enabled || record.transport !== 'streamable-http' || record.url === null) {
        throw new Error('Only enabled Streamable HTTP MCP servers can sign in.');
      }
      if (oauth === undefined) throw new Error('MCP sign-in is unavailable.');
      const url = record.url;
      await oauth.authorize(id, url, () => {
        const current = store.findMcpServer(id);
        return !closing
          && current?.enabled === true
          && current.transport === 'streamable-http'
          && current.url === url;
      });
      await reconnect(id);
    },

    async signOut(id) {
      await loadSecrets();
      if (store.findMcpServer(id) === undefined) throw new Error('That MCP server does not exist.');
      if (oauth === undefined) throw new Error('MCP sign-in is unavailable.');
      const current = servers.get(id);
      if (current !== undefined) await closeState(current);
      await oauth.signOut(id);
      await reconnect(id);
    },

    async setEnabled(id, enabled) {
      const record = store.setMcpServerEnabled(id, enabled);
      if (record === undefined) throw new Error('That MCP server does not exist.');
      if (!enabled) oauth?.invalidate(id);
      await replaceAndConnect(id, record);
    },

    async setToolSelection(id, selection) {
      const record = store.setMcpServerToolSelection(id, selection);
      const state = servers.get(id);
      if (record === undefined || state === undefined) {
        throw new Error('That MCP server does not exist.');
      }
      state.snapshot = {
        ...record,
        status: state.snapshot.status,
        error: state.snapshot.error,
        tools: [],
        hasCredentials: secrets?.has(id) ?? false,
        credentialsPersisted: secrets?.persisted(id) ?? false,
        hasOAuth: secrets?.hasOAuth(id) ?? false,
        oauthCredentialsPersisted: secrets?.persistedOAuth(id) ?? false,
      };
      state.snapshot.tools = bindingsFor(state.snapshot, state.allTools);
      notify();
    },

    connect,

    async connectWorkspace(workspaceId) {
      // start() registers every saved row before it waits on network/process
      // connections. Do not await that shared connection batch: an unrelated
      // hung global server must not stop a workspace chat from opening.
      if (!started) void start();
      await registered;
      activeWorkspaces.add(workspaceId);
      await Promise.all(
        [...servers.values()]
          .filter(
            (state) => state.snapshot.scope === 'workspace'
              && state.snapshot.workspaceId === workspaceId,
          )
          .map((state) => connect(state.snapshot.id)),
      );
    },

    async forgetWorkspace(workspaceId) {
      if (started) await registered;
      activeWorkspaces.delete(workspaceId);
      const forgotten = [...servers.values()].filter(
        (state) => state.snapshot.scope === 'workspace'
          && state.snapshot.workspaceId === workspaceId,
      );
      await Promise.all(forgotten.map(async (state) => {
        oauth?.invalidate(state.snapshot.id);
        await closeState(state);
        await secrets?.forget(state.snapshot.id);
      }));
      for (const state of forgotten) servers.delete(state.snapshot.id);
      if (forgotten.length > 0) notify();
    },

    snapshot(id) {
      return servers.get(id)?.snapshot;
    },

    snapshots() {
      return [...servers.values()].map((state) => state.snapshot);
    },

    tools(workspaceId = null) {
      const visible = visibleTools(workspaceId);
      return [...visible.values()].filter((tool) => tool.selected);
    },

    async callTool(name, arguments_, signal, workspaceId = null) {
      const tool = [...visibleTools(workspaceId).values()].find(
        (candidate) => candidate.name === name && candidate.selected,
      );
      if (tool === undefined) throw new Error('server disconnected');

      const state = servers.get(tool.serverId);
      if (state?.client === undefined || state.removing || state.snapshot.status !== 'connected') {
        throw new Error('server disconnected');
      }

      const client = state.client;
      try {
        const result = await client.callTool(
          { name: tool.toolName, arguments: arguments_ },
          signal === undefined ? undefined : { signal },
        );
        if (
          state.client !== client
          || state.snapshot.status !== 'connected'
          || !state.snapshot.tools.some((candidate) => candidate.name === name && candidate.selected)
        ) {
          throw new Error('server disconnected');
        }
        return result;
      } catch (error) {
        if (
          state.client !== client
          || state.snapshot.status !== 'connected'
          || !state.snapshot.tools.some((candidate) => candidate.name === name && candidate.selected)
        ) {
          throw new Error('server disconnected');
        }
        throw error;
      }
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    close() {
      if (shutdown !== undefined) return shutdown;

      closing = true;
      const states = [...servers.values()];
      shutdown = (async () => {
        await Promise.all([oauth?.close(), ...states.map((state) => closeState(state))]);
        await startup?.catch(() => undefined);
        listeners.clear();
      })();
      return shutdown;
    },
  };
}

function recordSnapshot(record: McpServerRecord): McpServerSnapshot {
  return {
    ...record,
    status: record.enabled ? 'not-started' : 'disabled',
    error: null,
    tools: [],
    hasCredentials: false,
    credentialsPersisted: false,
    hasOAuth: false,
    oauthCredentialsPersisted: false,
  };
}
