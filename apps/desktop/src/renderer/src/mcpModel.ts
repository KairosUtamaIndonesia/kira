/**
 * PROTOTYPE — MCP servers settings redesign. Wipe me once a variant has won (the pure helpers
 * and their test are meant to stay).
 *
 * What every variant of the page is handed: the saved servers and what can be done to them,
 * plus the words for a server (its status, how it is reached) and the form's rules, so the
 * variants are judged on layout rather than on wording.
 */
import type {
  McpCredentialsDraft,
  McpServer,
  McpServerDraft,
  McpServerStatus,
  McpToolSelection,
  WorkspaceSummary,
} from '../../preload/bridge';

export interface McpModel {
  /** Null until the main process has answered. */
  servers: McpServer[] | null;
  workspaces: readonly WorkspaceSummary[];
  busy: boolean;
  /** What was last refused, in the main process's words. */
  problem: string | null;
  clearProblem(): void;
  /** Add (id null) or replace a server. Resolves the saved server, or null when it was refused. */
  save(id: string | null, draft: McpServerDraft): Promise<McpServer | null>;
  remove(id: string): Promise<boolean>;
  reconnect(server: McpServer): Promise<void>;
  setEnabled(server: McpServer, enabled: boolean): Promise<void>;
  setTools(server: McpServer, selection: McpToolSelection): Promise<void>;
  signIn(server: McpServer): Promise<void>;
  signOut(server: McpServer): Promise<void>;
}

export type Tone = 'success' | 'warning' | 'error' | 'accent' | 'neutral';

const STATUS: Record<McpServerStatus, { label: string; tone: Tone }> = {
  connected: { label: 'Connected', tone: 'success' },
  connecting: { label: 'Connecting', tone: 'accent' },
  failed: { label: 'Failed', tone: 'error' },
  'needs-sign-in': { label: 'Needs sign-in', tone: 'warning' },
  disabled: { label: 'Off', tone: 'neutral' },
  'not-started': { label: 'Not started', tone: 'neutral' },
};

export function statusOf(server: McpServer): { label: string; tone: Tone } {
  return STATUS[server.status];
}

export function kindOf(server: McpServer): 'Local' | 'Remote' {
  return server.transport === 'stdio' ? 'Local' : 'Remote';
}

export function toolsOf(server: McpServer): string {
  const count = server.tools.length;
  return `${count} ${count === 1 ? 'tool' : 'tools'}`;
}

/** What a person would type to reach the server: its command line, or its link. */
export function reachOf(server: McpServer): string {
  return server.transport === 'stdio'
    ? joinCommand([server.command, ...server.args])
    : (server.url ?? '');
}

/** Where a server is offered: every chat, or the one workspace's. */
export function scopeLabel(server: McpServer, workspaces: readonly WorkspaceSummary[]): string {
  if (server.scope === 'global') return 'Every chat';
  return workspaces.find((each) => each.id === server.workspaceId)?.name ?? 'A removed workspace';
}

/**
 * Split a pasted command into its command and arguments on whitespace and newlines, keeping
 * what is inside single or double quotes together.
 */
export function splitCommand(text: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let started = false;

  for (const char of text) {
    if (quote !== null) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/u.test(char)) {
      if (started || current !== '') tokens.push(current);
      current = '';
      started = false;
    } else {
      current += char;
    }
  }
  if (started || current !== '') tokens.push(current);
  return tokens;
}

/** The inverse of {@link splitCommand}: quote only the pieces that need it. */
export function joinCommand(tokens: string[]): string {
  return tokens
    .map((token) => {
      if (token !== '' && !/[\s"']/u.test(token)) return token;
      return token.includes('"') ? `'${token}'` : `"${token}"`;
    })
    .join(' ');
}

export interface Pair {
  key: string;
  value: string;
}

/** What the form holds, in the shapes a person edits them in. */
export interface FormValues {
  name: string;
  /** 'global', or the id of the workspace the server is offered in. */
  scope: string;
  transport: 'stdio' | 'streamable-http';
  command: string;
  cwd: string;
  url: string;
  env: Pair[];
  headers: Pair[];
  bearerToken: string;
  clearCredentials: boolean;
  toolSelection: McpToolSelection;
}

export function blankForm(scope = 'global'): FormValues {
  return {
    name: '',
    scope,
    transport: 'stdio',
    command: '',
    cwd: '',
    url: '',
    env: [],
    headers: [],
    bearerToken: '',
    clearCredentials: false,
    toolSelection: 'all',
  };
}

/** A saved server as the form shows it. Credentials never come back, so those fields start empty. */
export function formOf(server: McpServer): FormValues {
  return {
    ...blankForm(server.scope === 'global' ? 'global' : (server.workspaceId ?? 'global')),
    name: server.name,
    transport: server.transport,
    command: server.transport === 'stdio' ? reachOf(server) : '',
    cwd: server.cwd ?? '',
    url: server.url ?? '',
    toolSelection: server.toolSelection,
  };
}

function record(pairs: Pair[], what: string): Record<string, string> | string {
  const out: Record<string, string> = {};
  for (const { key, value } of pairs) {
    const name = key.trim();
    if (name === '' && value === '') continue;
    if (name === '') return `Give every ${what} a name.`;
    if (name in out) return `${name} is listed twice.`;
    out[name] = value;
  }
  return out;
}

/** The draft the main process takes, or the sentence saying what is missing. */
export function buildDraft(form: FormValues): { draft: McpServerDraft } | { error: string } {
  const name = form.name.trim();
  if (name === '') return { error: 'Give the server a name.' };

  let credentials: McpCredentialsDraft | undefined;
  let command = '';
  let args: string[] = [];

  if (form.transport === 'stdio') {
    const [first, ...rest] = splitCommand(form.command);
    if (first === undefined) return { error: 'Add the command that starts the server.' };
    command = first;
    args = rest;

    const env = record(form.env, 'environment variable');
    if (typeof env === 'string') return { error: env };
    if (form.clearCredentials) credentials = { env: null };
    else if (Object.keys(env).length > 0) credentials = { env };
  } else {
    if (form.url.trim() === '') return { error: 'Add the link to the server.' };

    const headers = record(form.headers, 'header');
    if (typeof headers === 'string') return { error: headers };
    if (form.clearCredentials) {
      credentials = { headers: null, bearerToken: null };
    } else {
      const changed: McpCredentialsDraft = {};
      if (Object.keys(headers).length > 0) changed.headers = headers;
      if (form.bearerToken !== '') changed.bearerToken = form.bearerToken;
      if (Object.keys(changed).length > 0) credentials = changed;
    }
  }

  return {
    draft: {
      scope: form.scope === 'global' ? 'global' : 'workspace',
      workspaceId: form.scope === 'global' ? null : form.scope,
      name,
      transport: form.transport,
      command,
      args,
      cwd: form.transport === 'stdio' ? form.cwd.trim() || null : null,
      url: form.transport === 'streamable-http' ? form.url.trim() : null,
      toolSelection: form.toolSelection,
      ...(credentials === undefined ? {} : { credentials }),
    },
  };
}

export interface ScopeGroup {
  /** 'global', or a workspace's id. */
  id: string;
  label: string;
  servers: McpServer[];
}

/** Every chat first, then the workspaces that hold a server of their own. */
export function groupByScope(
  servers: McpServer[],
  workspaces: readonly WorkspaceSummary[],
): ScopeGroup[] {
  const groups: ScopeGroup[] = [
    {
      id: 'global',
      label: 'Every chat',
      servers: servers.filter((each) => each.scope === 'global'),
    },
    ...workspaces.map((workspace) => ({
      id: workspace.id,
      label: workspace.name,
      servers: servers.filter((each) => each.workspaceId === workspace.id),
    })),
  ];
  return groups.filter((group) => group.id === 'global' || group.servers.length > 0);
}

export function matches(server: McpServer, query: string): boolean {
  const wanted = query.trim().toLowerCase();
  if (wanted === '') return true;
  return `${server.name} ${reachOf(server)}`.toLowerCase().includes(wanted);
}

function pairsOf(value: unknown): Pair[] {
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).map(([key, each]) => ({ key, value: String(each) }));
}

/**
 * Read a server out of the JSON a README shows: `{ "mcpServers": { "name": { … } } }`, a map of
 * one name to its settings, or the settings alone. Only what is in the snippet is returned, so
 * the form keeps whatever it already held for the rest.
 */
export function parseSnippet(text: string): Partial<FormValues> | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: 'That is not valid JSON.' };
  }
  if (typeof parsed !== 'object' || parsed === null) return { error: 'Paste a JSON object.' };

  let entry = parsed as Record<string, unknown>;
  let name: string | undefined;
  const wrapped = entry['mcpServers'] ?? entry['servers'];
  const holder = (typeof wrapped === 'object' && wrapped !== null ? wrapped : entry) as Record<
    string,
    unknown
  >;
  if (!('command' in holder) && !('url' in holder)) {
    const names = Object.keys(holder);
    const only = names.length === 1 ? holder[names[0] as string] : undefined;
    if (typeof only !== 'object' || only === null) {
      return { error: 'Paste one server: its command or url, or a map of one name to them.' };
    }
    name = names[0];
    entry = only as Record<string, unknown>;
  } else {
    entry = holder;
  }

  const found: Partial<FormValues> = name === undefined ? {} : { name };
  if (typeof entry['command'] === 'string') {
    const args = Array.isArray(entry['args']) ? entry['args'].map(String) : [];
    found.transport = 'stdio';
    found.command = joinCommand([entry['command'], ...args]);
    found.env = pairsOf(entry['env']);
  } else if (typeof entry['url'] === 'string') {
    found.transport = 'streamable-http';
    found.url = entry['url'];
    found.headers = pairsOf(entry['headers']);
  } else {
    return { error: 'The snippet needs a command or a url.' };
  }
  return found;
}
