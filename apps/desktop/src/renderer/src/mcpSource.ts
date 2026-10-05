/**
 * PROTOTYPE — where the MCP page's servers come from: the main process, or a made-up set kept
 * in memory so a layout can be judged with a populated list, a failing server and an empty page
 * without touching anyone's real configuration. Wipe me with the variants.
 */
import type {
  McpServer,
  McpServerDraft,
  McpToolSelection,
  McpToolSummary,
  Result,
  WorkspaceSummary,
} from '../../preload/bridge';

export interface McpSource {
  load(): Promise<Result<McpServer[]>>;
  subscribe(listener: (servers: McpServer[]) => void): () => void;
  add(draft: McpServerDraft): Promise<Result<McpServer>>;
  update(id: string, draft: McpServerDraft): Promise<Result<McpServer>>;
  remove(id: string): Promise<Result<null>>;
  reconnect(id: string): Promise<Result<null>>;
  setEnabled(id: string, enabled: boolean): Promise<Result<null>>;
  setTools(id: string, selection: McpToolSelection): Promise<Result<null>>;
  signIn(id: string): Promise<Result<null>>;
  signOut(id: string): Promise<Result<null>>;
}

export function liveSource(): McpSource {
  const kira = window.kira;
  return {
    load: () => kira.loadMcpServers(),
    subscribe: (listener) => kira.onMcpEvent(listener),
    add: (draft) => kira.addMcpServer(draft),
    update: (id, draft) => kira.updateMcpServer(id, draft),
    remove: (id) => kira.removeMcpServer(id),
    reconnect: (id) => kira.reconnectMcpServer(id),
    setEnabled: (id, enabled) => kira.setMcpServerEnabled(id, enabled),
    setTools: (id, selection) => kira.setMcpServerToolSelection(id, selection),
    signIn: (id) => kira.signInMcpServer(id),
    signOut: (id) => kira.signOutMcpServer(id),
  };
}

function tools(names: string[], description: (name: string) => string): McpToolSummary[] {
  return names.map((toolName) => ({
    name: toolName,
    toolName,
    description: description(toolName),
    selected: true,
  }));
}

function server(id: string, change: Partial<McpServer>): McpServer {
  return {
    id,
    scope: 'global',
    workspaceId: null,
    name: id,
    transport: 'stdio',
    command: '',
    args: [],
    cwd: null,
    url: null,
    toolSelection: 'all',
    enabled: true,
    status: 'connected',
    error: null,
    tools: [],
    hasCredentials: false,
    credentialsPersisted: false,
    hasOAuth: false,
    oauthCredentialsPersisted: false,
    ...change,
  };
}

export function sampleServers(workspaces: readonly WorkspaceSummary[]): McpServer[] {
  const workspace = workspaces[0];
  return [
    server('coolify', {
      command: 'npx',
      args: ['-y', '@masonator/coolify-mcp'],
      hasCredentials: true,
      credentialsPersisted: true,
      tools: tools(
        [
          'list_servers',
          'list_applications',
          'deploy_application',
          'restart_application',
          'get_logs',
          'list_databases',
          'diagnose_app',
          'find_issues',
        ],
        (name) => `Coolify: ${name.replace(/_/gu, ' ')}.`,
      ),
    }),
    server('astryx', {
      transport: 'streamable-http',
      url: 'https://astryx.atmeta.com/mcp',
      tools: tools(['search', 'get'], (name) =>
        name === 'search' ? 'Search the design system.' : 'Read one component or doc.',
      ),
    }),
    server('paper', {
      command: '/home/brandon/.paper/bin/paper-mcp',
      args: ['--stdio'],
      cwd: '/home/brandon/Workspace/foundry',
      tools: tools(
        ['get_basic_info', 'get_screenshot', 'write_html', 'update_styles', 'delete_nodes'],
        (name) => `Paper: ${name.replace(/_/gu, ' ')}.`,
      ),
    }),
    server('linear', {
      transport: 'streamable-http',
      url: 'https://mcp.linear.app/mcp',
      status: 'needs-sign-in',
      oauthCredentialsPersisted: true,
    }),
    server('postgres', {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://user:pass@host/db'],
      status: 'failed',
      error: 'The server exited before it answered: connect ECONNREFUSED 127.0.0.1:5432',
      hasCredentials: true,
    }),
    ...(workspace === undefined
      ? []
      : [
          server('github', {
            scope: 'workspace',
            workspaceId: workspace.id,
            command: 'docker',
            args: ['run', '-i', '--rm', 'ghcr.io/github/github-mcp-server'],
            enabled: false,
            status: 'disabled',
            tools: tools(['search_issues', 'create_pull_request'], (name) => name),
          }),
        ]),
  ];
}

/** An in-memory set that behaves like the main process: every change is announced to listeners. */
export function sampleSource(initial: McpServer[]): McpSource {
  let servers = initial;
  let next = 1;
  const listeners = new Set<(servers: McpServer[]) => void>();
  const ok = <T>(value: T): Promise<Result<T>> => Promise.resolve({ ok: true, value });

  function publish(change: (current: McpServer[]) => McpServer[]): void {
    servers = change(servers);
    for (const listener of listeners) listener(servers);
  }
  function patch(id: string, change: Partial<McpServer>): void {
    publish((current) => current.map((each) => (each.id === id ? { ...each, ...change } : each)));
  }
  function connect(id: string): void {
    patch(id, { status: 'connecting', error: null });
    setTimeout(() => patch(id, { status: 'connected' }), 700);
  }
  function fromDraft(id: string, draft: McpServerDraft, before?: McpServer): McpServer {
    return server(id, {
      ...before,
      scope: draft.scope ?? 'global',
      workspaceId: draft.workspaceId ?? null,
      name: draft.name,
      transport: draft.transport,
      command: draft.command,
      args: draft.args,
      cwd: draft.cwd,
      url: draft.url,
      toolSelection: draft.toolSelection,
      hasCredentials: draft.credentials === undefined ? (before?.hasCredentials ?? false) : true,
    });
  }

  return {
    load: () => ok(servers),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    add(draft) {
      const made = fromDraft(`sample-${next++}`, draft);
      publish((current) => [...current, made]);
      connect(made.id);
      return ok(made);
    },
    update(id, draft) {
      const before = servers.find((each) => each.id === id);
      const made = fromDraft(id, draft, before);
      publish((current) => current.map((each) => (each.id === id ? made : each)));
      return ok(made);
    },
    remove(id) {
      publish((current) => current.filter((each) => each.id !== id));
      return ok(null);
    },
    reconnect(id) {
      connect(id);
      return ok(null);
    },
    setEnabled(id, enabled) {
      patch(id, { enabled, status: enabled ? 'connected' : 'disabled' });
      return ok(null);
    },
    setTools(id, selection) {
      const before = servers.find((each) => each.id === id);
      patch(id, {
        toolSelection: selection,
        tools: (before?.tools ?? []).map((tool) => ({
          ...tool,
          selected: selection === 'all' || selection.includes(tool.toolName),
        })),
      });
      return ok(null);
    },
    signIn(id) {
      patch(id, { hasOAuth: true, status: 'connected' });
      return ok(null);
    },
    signOut(id) {
      patch(id, { hasOAuth: false, status: 'needs-sign-in' });
      return ok(null);
    },
  };
}
