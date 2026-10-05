/**
 * PROTOTYPE — Git hosts settings redesign. Wipe me once a variant has won.
 *
 * What every variant of the page is handed: the server's connections, and the two things a
 * person can do to them. The variants own how it looks and which fields they ask for; this
 * file owns the words they share so the three can be compared on layout, not on wording.
 */
import type { GitConnection, GitHubConnect } from '../../preload/bridge';

export interface HostsModel {
  /** Null until the server has answered. */
  connections: GitConnection[] | null;
  /** What the server last refused, in its own words. */
  trouble: string | null;
  busy: boolean;
  /** A token connection's webhook secret, shown once and then gone. */
  secret: { id: string; value: string } | null;
  dismissSecret(): void;
  github: GitHubConnect | null;
  /** Resolves true when the host was connected, so the form can put itself away. */
  connect(input: ConnectInput): Promise<boolean>;
  disconnect(id: string): Promise<void>;
}

export interface ConnectInput {
  provider: string;
  instanceUrl: string;
  accessToken: string;
  accountLogin: string;
}

export interface Provider {
  value: string;
  label: string;
  /** Where the provider's public service lives, when it has one. */
  hosted: string | null;
  /** What the address field suggests. */
  example: string;
}

export const PROVIDERS: Provider[] = [
  { value: 'github', label: 'GitHub', hosted: 'github.com', example: 'https://github.example.com' },
  { value: 'gitlab', label: 'GitLab', hosted: 'gitlab.com', example: 'https://gitlab.com' },
  { value: 'forgejo', label: 'Forgejo', hosted: null, example: 'https://git.example.com' },
  { value: 'gitea', label: 'Gitea', hosted: null, example: 'https://git.example.com' },
];

/** The server takes GitHub without an address (github.com) and every other host with one. */
export function needsAddress(provider: string): boolean {
  return provider !== 'github';
}

/** Whether a form's fields are enough to connect: a token, and an https address where one is due. */
export function canConnect(input: ConnectInput): boolean {
  if (input.accessToken.trim() === '') return false;
  if (needsAddress(input.provider)) return isHttps(input.instanceUrl);
  return input.instanceUrl.trim() === '' || isHttps(input.instanceUrl);
}

export function providerLabel(provider: string): string {
  return PROVIDERS.find((each) => each.value === provider)?.label ?? provider;
}

/** The address a connection watches: its own server, or the provider's public one. */
export function addressOf(connection: GitConnection): string {
  if (connection.instanceUrl !== null) return connection.instanceUrl.replace(/^https?:\/\//u, '');
  return (
    PROVIDERS.find((each) => each.value === connection.provider)?.hosted ?? connection.provider
  );
}

export function accessLabel(connection: GitConnection): string {
  return connection.authKind === 'app' ? 'GitHub App' : 'Access token';
}

/** Only a token connection has a webhook of its own; the App's arrives on the server's shared one. */
export function webhookPath(connection: GitConnection): string | null {
  return connection.authKind === 'app' ? null : `/api/webhooks/git/${connection.id}`;
}

/** A server address must be https; the server says so too, this only saves the round trip. */
export function isHttps(value: string): boolean {
  return /^https:\/\/\S+$/u.test(value.trim());
}

const DAY = 86_400_000;

function ago(days: number): string {
  return new Date(Date.now() - days * DAY).toISOString();
}

/** Four connections of different kinds, so a layout is judged with a populated list. */
export const SAMPLE_CONNECTIONS: GitConnection[] = [
  {
    id: 'c0a1b2c3-0001',
    provider: 'github',
    authKind: 'app',
    instanceUrl: null,
    accountLogin: 'acme-inc',
    accountType: 'Organization',
    createdAt: ago(12),
  },
  {
    id: 'c0a1b2c3-0002',
    provider: 'github',
    authKind: 'token',
    instanceUrl: null,
    accountLogin: 'brandon',
    accountType: 'User',
    createdAt: ago(94),
  },
  {
    id: 'c0a1b2c3-0003',
    provider: 'forgejo',
    authKind: 'token',
    instanceUrl: 'https://git.acme.dev',
    accountLogin: 'kira-bot',
    accountType: 'User',
    createdAt: ago(5),
  },
  {
    id: 'c0a1b2c3-0004',
    provider: 'gitlab',
    authKind: 'token',
    instanceUrl: 'https://gitlab.example.com',
    accountLogin: 'platform',
    accountType: 'Organization',
    createdAt: ago(1),
  },
];

export const SAMPLE_GITHUB: GitHubConnect = {
  configured: true,
  url: 'https://github.com/apps/kira',
};
