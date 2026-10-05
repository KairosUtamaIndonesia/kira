/**
 * The Git hosts this server can watch, in Settings.
 *
 * A connection is server-wide and connecting one is an administrator's act, so
 * the form is shown to anyone and the server refuses whoever may not in its own
 * words. A token connection's webhook secret is answered once and never shown
 * again: it is stored sealed, and the host's webhook is what presents it back
 * (docs/adr/0026).
 *
 * This file holds the data and what can be done to it; `gitHostsLedger.tsx` draws the
 * page and `gitHostsConnectDialog.tsx` draws connecting.
 */
import { useCallback, useEffect, useState } from 'react';
import type { GitConnection, GitHubConnect } from '../../preload/bridge';
import { ConnectDialog } from './gitHostsConnectDialog';
import { HostsLedger } from './gitHostsLedger';
import type { ConnectInput, HostsModel } from './gitHostsModel';

function useMountEffect(effect: () => void): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(effect, []);
}

export function GitHostsSection() {
  const [connections, setConnections] = useState<GitConnection[] | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<{ id: string; value: string } | null>(null);
  const [github, setGithub] = useState<GitHubConnect | null>(null);
  const [adding, setAdding] = useState(false);

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
    connections,
    trouble,
    busy,
    secret,
    dismissSecret: () => setSecret(null),
    github,
    connect,
    disconnect,
  };

  return (
    <>
      <HostsLedger model={model} onConnect={() => setAdding(true)} />
      {(adding || secret !== null) && (
        <ConnectDialog
          model={model}
          onClose={() => {
            setAdding(false);
            void load();
          }}
        />
      )}
    </>
  );
}
