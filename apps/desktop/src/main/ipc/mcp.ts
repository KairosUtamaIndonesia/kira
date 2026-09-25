import {
  MCP_CHANNELS,
  type McpServer,
  type McpServerDraft,
  type McpToolSelection,
  type Result,
} from '../../preload/bridge.ts';
import { envelope, isId } from './result.ts';

export { MCP_CHANNELS };

export interface McpHandlers {
  load(): Promise<Result<McpServer[]>>;
  add(draft: unknown): Promise<Result<McpServer>>;
  update(id: unknown, draft: unknown): Promise<Result<McpServer>>;
  remove(id: unknown): Promise<Result<null>>;
  reconnect(id: unknown): Promise<Result<null>>;
  setEnabled(id: unknown, enabled: unknown): Promise<Result<null>>;
  setToolSelection(id: unknown, selection: unknown): Promise<Result<null>>;
  signIn(id: unknown): Promise<Result<null>>;
  signOut(id: unknown): Promise<Result<null>>;
}

export interface McpDeps {
  list(): McpServer[];
  workspaceExists?: (id: string) => boolean;
  add(draft: McpServerDraft): Promise<McpServer>;
  update(id: string, draft: McpServerDraft): Promise<McpServer>;
  remove(id: string): Promise<void>;
  reconnect(id: string): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  setToolSelection(id: string, selection: McpToolSelection): Promise<void>;
  signIn(id: string): Promise<void>;
  signOut(id: string): Promise<void>;
}

export function mcpHandlers({
  list,
  workspaceExists,
  add,
  update,
  remove,
  reconnect,
  setEnabled,
  setToolSelection,
  signIn,
  signOut,
}: McpDeps): McpHandlers {
  function duplicate(
    name: string,
    scope: 'global' | 'workspace',
    workspaceId: string | null,
    exceptId?: string,
  ): boolean {
    return list().some(
      (server) => server.id !== exceptId
        && server.name === name
        && server.scope === scope
        && server.workspaceId === workspaceId,
    );
  }

  function scopeOf(draft: McpServerDraft): 'global' | 'workspace' {
    return draft.scope ?? 'global';
  }

  function workspaceOf(draft: McpServerDraft): string | null {
    return scopeOf(draft) === 'workspace' ? (draft.workspaceId ?? null) : null;
  }

  function validWorkspace(draft: McpServerDraft): boolean {
    const workspaceId = workspaceOf(draft);
    return scopeOf(draft) === 'global'
      ? workspaceId === null
      : workspaceId !== null && (workspaceExists?.(workspaceId) ?? true);
  }

  function duplicateMessage(scope: 'global' | 'workspace'): string {
    return scope === 'global'
      ? 'A global MCP server with that name already exists.'
      : 'A workspace MCP server with that name already exists.';
  }

  return {
    load: () => envelope(() => list().map(serverForWindow)),

    add: (draft) => {
      const valid = draftIn(draft);
      if (valid === null) {
        return Promise.resolve({ ok: false, error: 'That is not a valid MCP server.' });
      }
      if (!validWorkspace(valid)) {
        return Promise.resolve({ ok: false, error: 'That MCP workspace does not exist.' });
      }
      if (duplicate(valid.name, scopeOf(valid), workspaceOf(valid))) {
        return Promise.resolve({ ok: false, error: duplicateMessage(scopeOf(valid)) });
      }

      return envelope(async () => serverForWindow(await add(valid)));
    },

    update: (id, draft) => {
      if (!isId(id)) return Promise.resolve({ ok: false, error: 'That MCP server does not exist.' });
      const valid = draftIn(draft);
      if (valid === null) {
        return Promise.resolve({ ok: false, error: 'That is not a valid MCP server.' });
      }
      if (!validWorkspace(valid)) {
        return Promise.resolve({ ok: false, error: 'That MCP workspace does not exist.' });
      }
      if (duplicate(valid.name, scopeOf(valid), workspaceOf(valid), id)) {
        return Promise.resolve({ ok: false, error: duplicateMessage(scopeOf(valid)) });
      }
      return envelope(async () => serverForWindow(await update(id, valid)));
    },

    remove: (id) => {
      if (!isId(id)) return Promise.resolve({ ok: false, error: 'That MCP server does not exist.' });

      return envelope(async () => {
        await remove(id);
        return null;
      });
    },

    reconnect: (id) => {
      if (!isId(id)) return Promise.resolve({ ok: false, error: 'That MCP server does not exist.' });
      return envelope(async () => {
        await reconnect(id);
        return null;
      });
    },

    setEnabled: (id, enabled) => {
      if (!isId(id) || typeof enabled !== 'boolean') {
        return Promise.resolve({ ok: false, error: 'That MCP server setting is invalid.' });
      }
      return envelope(async () => {
        await setEnabled(id, enabled);
        return null;
      });
    },

    setToolSelection: (id, selection) => {
      if (!isId(id)) return Promise.resolve({ ok: false, error: 'That MCP server does not exist.' });
      const valid = toolSelectionIn(selection);
      if (valid === null) {
        return Promise.resolve({ ok: false, error: 'That MCP tool selection is invalid.' });
      }
      return envelope(async () => {
        await setToolSelection(id, valid);
        return null;
      });
    },

    signIn: (id) => {
      if (!isId(id)) return Promise.resolve({ ok: false, error: 'That MCP server does not exist.' });
      return envelope(async () => {
        await signIn(id);
        return null;
      });
    },

    signOut: (id) => {
      if (!isId(id)) return Promise.resolve({ ok: false, error: 'That MCP server does not exist.' });
      return envelope(async () => {
        await signOut(id);
        return null;
      });
    },
  };
}

function draftIn(value: unknown): McpServerDraft | null {
  if (typeof value !== 'object' || value === null) return null;
  const asked = value as {
    scope?: unknown;
    workspaceId?: unknown;
    name?: unknown;
    transport?: unknown;
    command?: unknown;
    args?: unknown;
    cwd?: unknown;
    url?: unknown;
    toolSelection?: unknown;
    credentials?: unknown;
  };

  if (typeof asked.name !== 'string' || asked.name.trim() === '') return null;
  const scope = asked.scope === undefined ? 'global' : asked.scope;
  if (scope !== 'global' && scope !== 'workspace') return null;
  const workspaceId = scope === 'workspace'
    ? typeof asked.workspaceId === 'string' && asked.workspaceId.trim() !== ''
      ? asked.workspaceId.trim()
      : null
    : null;
  if (scope === 'workspace' && workspaceId === null) return null;
  const transport = asked.transport === undefined
    ? (typeof asked.url === 'string' && asked.url.trim() !== '' ? 'streamable-http' : 'stdio')
    : asked.transport;
  if (transport !== 'stdio' && transport !== 'streamable-http') return null;

  const command = typeof asked.command === 'string' ? asked.command.trim() : '';
  const args = asked.args === undefined ? [] : asked.args;
  if (!Array.isArray(args) || !args.every((arg) => typeof arg === 'string')) return null;

  const cwd = asked.cwd === undefined || asked.cwd === null
    ? null
    : typeof asked.cwd === 'string' ? asked.cwd.trim() || null : undefined;
  if (cwd === undefined) return null;

  const selection = toolSelectionIn(asked.toolSelection);
  if (selection === null) return null;
  const credentials = credentialsIn(asked.credentials);
  if (credentials === null) return null;
  if (credentials !== undefined && (
    (transport === 'stdio' && (credentials.headers !== undefined || credentials.bearerToken !== undefined))
    || (transport === 'streamable-http' && credentials.env !== undefined)
  )) return null;

  if (transport === 'stdio') {
    if (command === '') return null;
    return {
      scope,
      workspaceId,
      name: asked.name.trim(),
      transport,
      command,
      args: [...args],
      cwd,
      url: null,
      toolSelection: selection,
      ...(credentials === undefined ? {} : { credentials }),
    };
  }

  if (typeof asked.url !== 'string' || !validMcpUrl(asked.url.trim())) return null;
  return {
    scope,
    workspaceId,
    name: asked.name.trim(),
    transport,
    command: '',
    args: [],
    cwd: null,
    url: asked.url.trim(),
    toolSelection: selection,
    ...(credentials === undefined ? {} : { credentials }),
  };
}

function credentialsIn(value: unknown): McpServerDraft['credentials'] | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const asked = value as { env?: unknown; headers?: unknown; bearerToken?: unknown };
  const result: NonNullable<McpServerDraft['credentials']> = {};
  for (const key of ['env', 'headers'] as const) {
    const value = asked[key];
    if (value === undefined) continue;
    if (value === null) {
      result[key] = null;
      continue;
    }
    if (typeof value !== 'object' || Array.isArray(value)) return null;
    const entries = Object.entries(value);
    const valid = entries.every(([name, secret]) => {
      if (typeof secret !== 'string') return false;
      if (key === 'env') return /^[A-Za-z_][A-Za-z0-9_]*$/u.test(name);
      return /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(name) && !/[\r\n]/u.test(secret);
    });
    if (!valid) return null;
    result[key] = Object.fromEntries(entries);
  }
  if (asked.bearerToken !== undefined) {
    if (asked.bearerToken !== null && typeof asked.bearerToken !== 'string') return null;
    if (typeof asked.bearerToken === 'string' && /[\r\n]/u.test(asked.bearerToken)) return null;
    result.bearerToken = asked.bearerToken as string | null;
  }
  return result;
}

function serverForWindow(server: McpServer): McpServer {
  return {
    id: server.id,
    scope: server.scope,
    workspaceId: server.workspaceId,
    name: server.name,
    transport: server.transport,
    command: server.command,
    args: [...server.args],
    cwd: server.cwd,
    url: server.url,
    toolSelection: Array.isArray(server.toolSelection) ? [...server.toolSelection] : 'all',
    enabled: server.enabled,
    status: server.status,
    error: server.error,
    tools: server.tools.map((tool) => ({ ...tool })),
    hasCredentials: server.hasCredentials === true,
    credentialsPersisted: server.credentialsPersisted === true,
    hasOAuth: server.hasOAuth === true,
    oauthCredentialsPersisted: server.oauthCredentialsPersisted === true,
  };
}

function toolSelectionIn(value: unknown): McpToolSelection | null {
  if (value === undefined || value === 'all') return 'all';
  if (!Array.isArray(value) || !value.every((name) => typeof name === 'string' && name !== '')) return null;
  return [...new Set(value)];
}

function validMcpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
