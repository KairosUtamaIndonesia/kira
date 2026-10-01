/**
 * The Git hosts this server can watch, in Settings.
 *
 * A connection is server-wide and connecting one is an administrator's act, so
 * the form is shown to anyone and the server refuses whoever may not in its own
 * words. A token connection's webhook secret is answered once and never shown
 * again: it is stored sealed, and the host's webhook is what presents it back
 * (docs/adr/0026).
 */
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Section } from '@astryxdesign/core/Section';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { useCallback, useEffect, useState } from 'react';
import type { GitConnection } from '../../preload/bridge';

const HOSTS = [
  { value: 'github', label: 'GitHub' },
  { value: 'forgejo', label: 'Forgejo' },
  { value: 'gitea', label: 'Gitea' },
  { value: 'gitlab', label: 'GitLab' },
];

function useMountEffect(effect: () => void): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(effect, []);
}

export function GitHostsSection() {
  const [connections, setConnections] = useState<GitConnection[] | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [provider, setProvider] = useState('github');
  const [instanceUrl, setInstanceUrl] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [accountLogin, setAccountLogin] = useState('');
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<{ id: string; value: string } | null>(null);

  const load = useCallback(async () => {
    const answer = await window.kira.loadGitConnections();
    if (answer.ok) {
      setConnections(answer.value);
      setTrouble(null);
    } else {
      setTrouble(answer.error);
    }
  }, []);

  useMountEffect(() => {
    void load();
  });

  async function connect(): Promise<void> {
    if (busy || accessToken.trim() === '') return;

    setBusy(true);
    const answer = await window.kira.connectGitHost({
      provider,
      accessToken: accessToken.trim(),
      ...(instanceUrl.trim() === '' ? {} : { instanceUrl: instanceUrl.trim() }),
      ...(accountLogin.trim() === '' ? {} : { accountLogin: accountLogin.trim() }),
    });
    setBusy(false);

    if (!answer.ok) {
      setTrouble(answer.error);
      return;
    }

    setSecret({ id: answer.value.connection.id, value: answer.value.webhookSecret });
    setAccessToken('');
    setAccountLogin('');
    setTrouble(null);
    await load();
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

  return (
    <Section padding={4}>
      <VStack gap={4}>
        <VStack gap={1}>
          <Heading level={2}>Git hosts</Heading>
          <Text color="secondary" size="sm">
            A repository is watched once it is attached to a project, and its host is connected
            here. Connecting needs an administrator and a personal access token.
          </Text>
        </VStack>

        {trouble !== null && (
          <Text color="secondary" size="sm">
            {trouble}
          </Text>
        )}

        {secret !== null && (
          <VStack gap={1}>
            <Text weight="bold" size="sm">
              Webhook secret — copy it now, it is shown once
            </Text>
            <Text size="sm" color="secondary">
              {secret.value}
            </Text>
            <Text size="sm" color="secondary">
              {`Point the host’s webhook at /api/webhooks/git/${secret.id}.`}
            </Text>
          </VStack>
        )}

        {connections === null ? (
          <Text size="sm" color="secondary">
            Loading hosts
          </Text>
        ) : connections.length === 0 ? (
          <Text size="sm" color="secondary">
            No hosts are connected yet.
          </Text>
        ) : (
          <VStack gap={2}>
            {connections.map((connection) => (
              <HStack key={connection.id} justify="between" align="center">
                <VStack gap={0.5}>
                  <Text weight="bold" size="sm">
                    {connection.instanceUrl ?? 'github.com'}
                  </Text>
                  <Text color="secondary" size="sm">
                    {`${connection.provider} · ${connection.authKind}`}
                  </Text>
                </VStack>
                <Button
                  label="Disconnect"
                  size="sm"
                  variant="ghost"
                  isDisabled={busy}
                  onClick={() => void disconnect(connection.id)}
                />
              </HStack>
            ))}
          </VStack>
        )}

        <VStack gap={3}>
          <Selector
            label="Host"
            options={HOSTS}
            value={provider}
            isDisabled={busy}
            onChange={(value) => setProvider(value ?? 'github')}
          />
          <TextInput
            label="Address"
            value={instanceUrl}
            placeholder="https://git.example.com"
            size="sm"
            onChange={setInstanceUrl}
          />
          <TextInput label="Access token" value={accessToken} size="sm" onChange={setAccessToken} />
          <TextInput
            label="Account (optional)"
            value={accountLogin}
            placeholder="acme"
            size="sm"
            onChange={setAccountLogin}
          />
          <HStack justify="end">
            <Button
              label={busy ? 'Connecting' : 'Connect host'}
              size="sm"
              variant="primary"
              isDisabled={busy || accessToken.trim() === ''}
              onClick={() => void connect()}
            />
          </HStack>
        </VStack>
      </VStack>
    </Section>
  );
}
