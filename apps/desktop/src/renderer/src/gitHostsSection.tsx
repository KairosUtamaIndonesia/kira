/**
 * The Git hosts this server can watch, in Settings.
 *
 * A connection is server-wide and connecting one is an administrator's act, so
 * the form is shown to anyone and the server refuses whoever may not in its own
 * words. A token connection's webhook secret is answered once and never shown
 * again: it is stored sealed, and the host's webhook is what presents it back
 * (docs/adr/0026).
 *
 * PROTOTYPE — this file holds the data and picks which layout draws it. Development
 * builds can flip between the page as it is and three redesigns with the bar at the foot
 * of the window (`?variant=`), against the server's own connections, four made-up ones, or
 * none (`?hosts=`). Production always draws the current page.
 */
import { useCallback, useEffect, useState } from 'react';
import type { GitConnection, GitHubConnect } from '../../preload/bridge';
import { CurrentVariant } from './gitHostsCurrent';
import {
  SAMPLE_CONNECTIONS,
  SAMPLE_GITHUB,
  type ConnectInput,
  type HostsModel,
} from './gitHostsModel';
import { VariantA } from './gitHostsVariantA';
import { VariantB } from './gitHostsVariantB';
import { VariantC } from './gitHostsVariantC';
import { PrototypeSwitcher } from './prototypeSwitcher';

function useMountEffect(effect: () => void): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(effect, []);
}

const VARIANTS = [
  { key: 'current', name: 'As it is' },
  { key: 'A', name: 'Ledger' },
  { key: 'B', name: 'By provider' },
  { key: 'C', name: 'Table and dialog' },
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

const SAMPLE_SECRET = 'whsec_3f9a1c7e5b2d48a6c0e1f7b9d2a4c6e8';

export function GitHostsSection() {
  const [connections, setConnections] = useState<GitConnection[] | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<{ id: string; value: string } | null>(null);
  const [github, setGithub] = useState<GitHubConnect | null>(null);

  const [variant, setVariant] = useState(() =>
    import.meta.env.DEV ? readParam('variant', VARIANTS, 'A') : 'current',
  );
  const [data, setData] = useState(() =>
    import.meta.env.DEV ? readParam('hosts', DATA, 'live') : 'live',
  );
  const [made, setMade] = useState<GitConnection[]>(() =>
    data === 'sample' ? SAMPLE_CONNECTIONS : [],
  );

  const load = useCallback(async () => {
    const answer = await window.kira.loadGitConnections();
    if (answer.ok) {
      setConnections(answer.value);
      setTrouble(null);
    } else {
      setTrouble(answer.error);
    }
  }, []);

  const loadGithub = useCallback(async () => {
    const answer = await window.kira.loadGitHubConnect();
    if (answer.ok) setGithub(answer.value);
  }, []);

  useMountEffect(() => {
    void load();
    void loadGithub();
  });

  async function connect(input: ConnectInput): Promise<boolean> {
    if (busy || input.accessToken.trim() === '') return false;

    if (data !== 'live') {
      const connection: GitConnection = {
        id: `c0a1b2c3-${Date.now().toString(16)}`,
        provider: input.provider,
        authKind: 'token',
        instanceUrl: input.instanceUrl.trim() === '' ? null : input.instanceUrl.trim(),
        accountLogin: input.accountLogin.trim() || 'new-account',
        accountType: 'User',
        createdAt: new Date().toISOString(),
      };
      setMade((current) => [...current, connection]);
      setSecret({ id: connection.id, value: SAMPLE_SECRET });
      return true;
    }

    setBusy(true);
    const answer = await window.kira.connectGitHost({
      provider: input.provider,
      accessToken: input.accessToken.trim(),
      ...(input.instanceUrl.trim() === '' ? {} : { instanceUrl: input.instanceUrl.trim() }),
      ...(input.accountLogin.trim() === '' ? {} : { accountLogin: input.accountLogin.trim() }),
    });
    setBusy(false);

    if (!answer.ok) {
      setTrouble(answer.error);
      return false;
    }

    setSecret({ id: answer.value.connection.id, value: answer.value.webhookSecret });
    setTrouble(null);
    await load();
    return true;
  }

  async function disconnect(id: string): Promise<void> {
    if (data !== 'live') {
      setMade((current) => current.filter((each) => each.id !== id));
      if (secret?.id === id) setSecret(null);
      return;
    }

    setBusy(true);
    const answer = await window.kira.disconnectGitHost(id);
    setBusy(false);

    if (!answer.ok) {
      setTrouble(answer.error);
      return;
    }

    if (secret?.id === id) setSecret(null);
    await load();
  }

  const model: HostsModel = {
    connections: data === 'live' ? connections : made,
    trouble: data === 'live' ? trouble : null,
    busy,
    secret,
    dismissSecret: () => setSecret(null),
    github: data === 'live' ? github : SAMPLE_GITHUB,
    connect,
    disconnect,
  };

  const page =
    variant === 'A' ? (
      <VariantA model={model} />
    ) : variant === 'B' ? (
      <VariantB model={model} />
    ) : variant === 'C' ? (
      <VariantC model={model} />
    ) : (
      <CurrentVariant model={model} />
    );

  return (
    <>
      {page}
      <PrototypeSwitcher
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
            writeParam('hosts', key);
            setData(key);
            setSecret(null);
            setMade(key === 'sample' ? SAMPLE_CONNECTIONS : []);
          },
        }}
      />
    </>
  );
}
