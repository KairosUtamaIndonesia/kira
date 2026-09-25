import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  discoverOAuthServerInfo,
  exchangeAuthorization,
  UnauthorizedError,
  registerClient,
  startAuthorization,
  type OAuthClientInformationContext,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
} from '@modelcontextprotocol/client';
import type { McpSecretStore } from './secrets.ts';

const CALLBACK_PATH = '/oauth/callback';
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;
const SIGN_IN_CANCELLED = 'MCP sign-in was cancelled.';

interface LoopbackCallback {
  redirectUrl: URL;
  result: Promise<URLSearchParams>;
  close(reason?: Error): Promise<void>;
}

export interface McpOAuth {
  authorize(serverId: string, serverUrl: string, isCurrent?: () => boolean): Promise<void>;
  provider(serverId: string): OAuthClientProvider;
  signOut(serverId: string): Promise<void>;
  invalidate(serverId: string): void;
  close(): Promise<void>;
}

/** OAuth state stays in the main process and is kept in its own sealed file. */
export function mcpOAuth({
  secrets,
  openExternal,
}: {
  secrets: McpSecretStore;
  openExternal: (url: URL) => Promise<void>;
}): McpOAuth {
  const generations = new Map<string, number>();
  const pending = new Map<string, (reason: Error) => Promise<void>>();

  function invalidate(serverId: string): void {
    generations.set(serverId, (generations.get(serverId) ?? 0) + 1);
    pending.get(serverId)?.(new Error(SIGN_IN_CANCELLED));
  }

  function provider(serverId: string): OAuthClientProvider {
    const generation = generations.get(serverId) ?? 0;
    const current = (): boolean => (generations.get(serverId) ?? 0) === generation;

    function clientInformation(
      ctx?: OAuthClientInformationContext,
    ): StoredOAuthClientInformation | undefined {
      if (!current()) return undefined;
      const value = secrets.readOAuth(serverId)?.clientInformation;
      if (ctx?.issuer !== undefined && value?.issuer !== undefined && value.issuer !== ctx.issuer) {
        return undefined;
      }
      return value;
    }

    function tokens(ctx?: OAuthClientInformationContext): StoredOAuthTokens | undefined {
      if (!current()) return undefined;
      const value = secrets.readOAuth(serverId)?.tokens;
      if (ctx?.issuer !== undefined && value?.issuer !== undefined && value.issuer !== ctx.issuer) {
        return undefined;
      }
      return value;
    }

    return {
      get redirectUrl() {
        // A background request can refresh saved tokens, but a new login must
        // be started from Settings rather than redirected from a chat request.
        return new URL('http://127.0.0.1/oauth/callback');
      },
      get clientMetadata(): OAuthClientMetadata {
        return clientMetadata('http://127.0.0.1/oauth/callback');
      },
      state: () => randomBytes(32).toString('base64url'),
      clientInformation,
      async saveClientInformation(value, ctx) {
        if (!current()) return;
        const stamped = withIssuer(value, ctx?.issuer);
        const changes: Parameters<McpSecretStore['updateOAuth']>[1] = {
          clientInformation: stamped,
        };
        const oldIssuer = secrets.readOAuth(serverId)?.tokens?.issuer;
        if (ctx?.issuer !== undefined && oldIssuer !== undefined && oldIssuer !== ctx.issuer) {
          changes.tokens = null;
        }
        await secrets.updateOAuth(serverId, changes);
      },
      tokens,
      async saveTokens(value, ctx) {
        if (!current()) return;
        await secrets.updateOAuth(serverId, { tokens: withIssuer(value, ctx?.issuer) });
      },
      redirectToAuthorization: async () => {
        throw new UnauthorizedError('MCP sign-in must be started from Settings.');
      },
      saveCodeVerifier: async (codeVerifier) => {
        if (!current()) return;
        await secrets.updateOAuth(serverId, { codeVerifier });
      },
      codeVerifier: async () =>
        current() ? (secrets.readOAuth(serverId)?.codeVerifier ?? '') : '',
      saveDiscoveryState: async (state) => {
        if (!current()) return;
        await secrets.updateOAuth(serverId, { discoveryState: state });
      },
      discoveryState: () => (current() ? secrets.readOAuth(serverId)?.discoveryState : undefined),
      async invalidateCredentials(scope) {
        if (!current()) return;
        if (scope === 'all') {
          await secrets.clearOAuth(serverId);
          return;
        }
        const changes: Parameters<McpSecretStore['updateOAuth']>[1] = {};
        if (scope === 'client') changes.clientInformation = null;
        if (scope === 'tokens') changes.tokens = null;
        if (scope === 'verifier') changes.codeVerifier = null;
        if (scope === 'discovery') changes.discoveryState = null;
        await secrets.updateOAuth(serverId, changes);
      },
    };
  }

  async function authorize(
    serverId: string,
    serverUrl: string,
    isCurrent: () => boolean = () => true,
  ): Promise<void> {
    if (pending.has(serverId)) throw new Error('MCP sign-in is already in progress.');
    const generation = generations.get(serverId) ?? 0;
    let callback: LoopbackCallback | undefined;
    const cancel = async (reason: Error): Promise<void> => {
      await callback?.close(reason);
    };
    pending.set(serverId, cancel);

    const current = (): boolean => (generations.get(serverId) ?? 0) === generation && isCurrent();
    const ensureCurrent = (): void => {
      if (!current()) throw new Error(SIGN_IN_CANCELLED);
    };

    try {
      await secrets.updateOAuth(serverId, { tokens: null, codeVerifier: null });
      const state = randomBytes(32).toString('base64url');
      callback = await listenForCallback(state);
      ensureCurrent();

      const serverInfo = await discoverOAuthServerInfo(new URL(serverUrl));
      const metadata = serverInfo.authorizationServerMetadata;
      if (metadata?.authorization_endpoint === undefined || metadata.token_endpoint === undefined) {
        throw new Error('The MCP server did not provide usable OAuth authorization metadata.');
      }
      ensureCurrent();

      const redirectUri = callback.redirectUrl.toString();
      const registered = await registerClient(serverInfo.authorizationServerUrl, {
        metadata,
        clientMetadata: clientMetadata(redirectUri),
      });
      const issuer = metadata.issuer ?? serverInfo.authorizationServerUrl;
      const clientInformation = withIssuer(registered, issuer);
      const discoveryState: OAuthDiscoveryState = { ...serverInfo };
      ensureCurrent();
      await secrets.updateOAuth(serverId, { clientInformation, discoveryState });
      ensureCurrent();

      const resource =
        serverInfo.resourceMetadata?.resource === undefined
          ? undefined
          : new URL(serverInfo.resourceMetadata.resource);
      const authorization = await startAuthorization(serverInfo.authorizationServerUrl, {
        metadata,
        clientInformation,
        redirectUrl: callback.redirectUrl,
        state,
        scope: serverInfo.resourceMetadata?.scopes_supported?.join(' '),
        resource,
      });
      // The verifier is encrypted before the system browser receives the URL.
      await secrets.updateOAuth(serverId, { codeVerifier: authorization.codeVerifier });
      ensureCurrent();

      const callbackResult = callback.result.then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      try {
        await openExternal(authorization.authorizationUrl);
      } catch {
        throw new Error('Could not open the system browser for MCP sign-in.');
      }
      const received = await callbackResult;
      if ('error' in received) throw received.error;
      ensureCurrent();

      const values = received.value;
      const callbackState = one(values, 'state');
      if (callbackState !== state) throw new Error('MCP sign-in callback state did not match.');
      if (one(values, 'error') !== undefined) throw new Error('MCP server sign-in was declined.');
      const code = one(values, 'code');
      if (code === undefined || code === '')
        throw new Error('MCP sign-in callback did not include an authorization code.');
      const iss = one(values, 'iss');
      const tokens = await exchangeAuthorization(serverInfo.authorizationServerUrl, {
        metadata,
        clientInformation,
        authorizationCode: code,
        ...(iss === undefined ? {} : { iss }),
        codeVerifier: authorization.codeVerifier,
        redirectUri,
        ...(resource === undefined ? {} : { resource }),
      });
      ensureCurrent();
      await secrets.updateOAuth(serverId, {
        tokens: withIssuer(tokens, issuer),
        codeVerifier: null,
      });
    } catch (error) {
      await secrets.updateOAuth(serverId, { codeVerifier: null }).catch(() => undefined);
      if (
        error instanceof Error &&
        (error.message === SIGN_IN_CANCELLED ||
          error.message === 'MCP sign-in callback state did not match.' ||
          error.message === 'MCP server sign-in was declined.' ||
          error.message === 'MCP sign-in callback did not include an authorization code.' ||
          error.message === 'Could not open the system browser for MCP sign-in.' ||
          error.message === 'The MCP server did not provide usable OAuth authorization metadata.' ||
          error.message === 'MCP sign-in is already in progress.' ||
          error.message === 'OAuth credentials require OS-backed encrypted storage.' ||
          error.message ===
            'Saved MCP OAuth credentials are unavailable; clear them before replacing.')
      )
        throw error;
      throw new Error('Could not complete MCP sign-in. Check the server URL and try again.');
    } finally {
      await callback?.close();
      pending.delete(serverId);
    }
  }

  return {
    authorize,
    provider,
    async signOut(serverId) {
      generations.set(serverId, (generations.get(serverId) ?? 0) + 1);
      await pending.get(serverId)?.(new Error(SIGN_IN_CANCELLED));
      await secrets.clearOAuth(serverId);
    },
    invalidate,
    async close() {
      const active = [...pending.entries()];
      const reason = new Error(SIGN_IN_CANCELLED);
      for (const [serverId] of active) {
        generations.set(serverId, (generations.get(serverId) ?? 0) + 1);
      }
      await Promise.all(active.map(([, cancel]) => cancel(reason)));
    },
  };
}

function clientMetadata(redirectUri: string): OAuthClientMetadata {
  return {
    client_name: 'Kira',
    redirect_uris: [redirectUri],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };
}

function withIssuer<T extends object>(value: T, issuer?: string): T & { issuer?: string } {
  return issuer === undefined ? (value as T & { issuer?: string }) : { ...value, issuer };
}

function one(values: URLSearchParams, key: string): string | undefined {
  const all = values.getAll(key);
  return all.length === 1 ? all[0] : undefined;
}

async function listenForCallback(state: string): Promise<LoopbackCallback> {
  let redirectUrl: URL;
  let resolve!: (value: URLSearchParams) => void;
  let reject!: (reason: Error) => void;
  const server = createServer((request, response) => {
    handleCallback(request, response, redirectUrl, state, resolve, reject);
  });
  let settled = false;
  let closing: Promise<void> | undefined;
  const result = new Promise<URLSearchParams>((accept, refuse) => {
    resolve = (value) => {
      settled = true;
      accept(value);
    };
    reject = (reason) => {
      if (settled) return;
      settled = true;
      refuse(reason);
    };
  });
  const timer = setTimeout(() => reject(new Error('MCP sign-in timed out.')), CALLBACK_TIMEOUT_MS);
  timer.unref();

  try {
    await new Promise<void>((accept, refuse) => {
      server.once('error', refuse);
      server.listen(0, '127.0.0.1', () => accept());
    });
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
  const address = server.address();
  if (address === null || typeof address === 'string') {
    clearTimeout(timer);
    throw new Error('Could not start the MCP sign-in callback.');
  }
  redirectUrl = new URL(CALLBACK_PATH, `http://127.0.0.1:${address.port}`);

  return {
    redirectUrl,
    result,
    close(reason) {
      clearTimeout(timer);
      if (reason !== undefined) reject(reason);
      if (closing !== undefined) return closing;
      if (!server.listening) return Promise.resolve();
      closing = new Promise<void>((accept) => server.close(() => accept()));
      return closing;
    },
  };
}

function handleCallback(
  request: IncomingMessage,
  response: ServerResponse,
  redirectUrl: URL,
  expectedState: string,
  resolve: (value: URLSearchParams) => void,
  reject: (reason: Error) => void,
): void {
  if (
    request.method !== 'GET' ||
    request.url === undefined ||
    request.headers.host !== redirectUrl.host ||
    !request.url.startsWith('/')
  ) {
    response.writeHead(404).end();
    return;
  }

  const callback = new URL(request.url, redirectUrl);
  if (callback.pathname !== CALLBACK_PATH) {
    response.writeHead(404).end();
    return;
  }
  const values = callback.searchParams;
  if (one(values, 'state') !== expectedState) {
    response
      .writeHead(400, { 'content-type': 'text/plain' })
      .end('This sign-in link is not valid.');
    return;
  }
  if (values.has('error')) {
    response.writeHead(400, { 'content-type': 'text/plain' }).end('MCP sign-in was not completed.');
    reject(new Error('MCP server sign-in was declined.'));
    return;
  }
  if (one(values, 'code') === undefined) {
    response
      .writeHead(400, { 'content-type': 'text/plain' })
      .end('This sign-in link is incomplete.');
    reject(new Error('MCP sign-in callback did not include an authorization code.'));
    return;
  }

  response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  response.end('MCP sign-in is complete. You can return to Kira.');
  resolve(values);
}
