import { Avatar } from '@astryxdesign/core/Avatar';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Section } from '@astryxdesign/core/Section';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { useEffect, useState } from 'react';
import {
  reflectingWith,
  type AuthUser,
  type DesktopUpdateSnapshot,
  type MemoryChoice,
  type MemorySettings,
  type McpCredentialsDraft,
  type McpServer,
  type ModelOption,
  type ShellSettingsSnapshot,
  type ShellTestResult,
  type WorkspaceSummary,
} from '../../preload/bridge';
import { canCheckDesktopUpdate, desktopUpdateStatusText } from './desktop-update-status';

function useMountEffect(effect: () => void | (() => void)): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(effect, []);
}

function PreferenceRow({ title, description }: { title: string; description: string }) {
  return (
    <HStack justify="between" align="center">
      <VStack gap={0.5}>
        <Text weight="bold" size="sm">
          {title}
        </Text>
        <Text color="secondary" size="sm">
          {description}
        </Text>
      </VStack>
      <Badge label="Coming later" variant="neutral" />
    </HStack>
  );
}

/** Which part of Settings is on screen. The rail's rows are these, one apiece. */
export type Setting = 'account' | 'memory' | 'mcp' | 'updates' | 'shell';

/**
 * The desktop app's settings page: one pane of what Settings holds, chosen by the
 * rail beside it. Settings replaces the chat rail rather than sitting beside it, so
 * leaving and signing out both live there — this page holds only what is specific
 * to it.
 */
export default function SettingsPage({
  user,
  models,
  workspaces,
  showing,
}: {
  user: AuthUser;
  /** The models Foundry offers, read once by the shell, because every chat shares them. */
  models: readonly ModelOption[];
  /** Workspaces are the scopes Settings groups MCP servers under. */
  workspaces: readonly WorkspaceSummary[];
  /** Which pane the rail has selected. */
  showing: Setting;
}) {
  return (
    <VStack gap={6} padding={6} maxWidth={640}>
      <Heading level={1}>Settings</Heading>

      {showing === 'account' ? (
        <AccountPane user={user} />
      ) : showing === 'memory' ? (
        <MemorySection models={models} />
      ) : showing === 'updates' ? (
        <UpdatesSection />
      ) : showing === 'shell' ? (
        <ShellSection />
      ) : (
        <McpSection workspaces={workspaces} />
      )}
    </VStack>
  );
}

/** The packaged desktop's release check and downloaded update. */
function UpdatesSection() {
  const [snapshot, setSnapshot] = useState<DesktopUpdateSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useMountEffect(() => {
    let mounted = true;
    const unsubscribe = window.foundry.onDesktopUpdateEvent((next) => {
      if (mounted) setSnapshot(next);
    });
    void window.foundry.loadDesktopUpdate().then((result) => {
      if (!mounted) return;
      if (result.ok) setSnapshot(result.value);
      else setProblem(result.error);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  });

  async function check(): Promise<void> {
    setBusy(true);
    setProblem(null);
    const result = await window.foundry.checkDesktopUpdate();
    setBusy(false);
    if (result.ok) setSnapshot(result.value);
    else setProblem(result.error);
  }

  async function install(): Promise<void> {
    setBusy(true);
    setProblem(null);
    const result = await window.foundry.installDesktopUpdate();
    setBusy(false);
    if (!result.ok) setProblem(result.error);
    else if (!result.value.installed) setProblem(result.value.message);
  }

  const status = desktopUpdateStatusText(snapshot);
  const canCheck = canCheckDesktopUpdate(snapshot);

  return (
    <>
      <VStack gap={1}>
        <Heading level={2}>Updates</Heading>
        <Text color="secondary" size="sm">
          Foundry checks for updates automatically and downloads them in the background.
        </Text>
      </VStack>
      <Section padding={4}>
        <VStack gap={3}>
          <Text color="secondary" size="sm">
            Version {snapshot?.currentVersion ?? '—'} · {status}
          </Text>
          {problem === null ? null : (
            <Text color="secondary" size="sm">
              {problem}
            </Text>
          )}
          <HStack gap={2}>
            {snapshot?.status === 'downloaded' ? (
              <Button
                label="Restart to update"
                variant="primary"
                size="sm"
                isDisabled={busy}
                onClick={() => void install()}
              />
            ) : (
              <Button
                label="Check for updates"
                variant="ghost"
                size="sm"
                isDisabled={busy || !canCheck}
                onClick={() => void check()}
              />
            )}
          </HStack>
        </VStack>
      </Section>
    </>
  );
}

/** A device-local Bash-compatible executable for Kira. */
function ShellSection() {
  const [snapshot, setSnapshot] = useState<ShellSettingsSnapshot | null>(null);
  const [path, setPath] = useState('');
  const [testedPath, setTestedPath] = useState<string | null | undefined>();
  const [testResult, setTestResult] = useState<ShellTestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useMountEffect(() => {
    let mounted = true;
    void window.foundry.loadShellSettings().then((result) => {
      if (!mounted) return;
      if (result.ok) {
        setSnapshot(result.value);
        setPath(result.value.configuredPath ?? '');
      } else {
        setProblem(result.error);
      }
    });
    return () => {
      mounted = false;
    };
  });

  const candidate = path.trim() === '' ? null : path.trim();

  async function browse(): Promise<void> {
    setProblem(null);
    const result = await window.foundry.browseShellPath();
    if (!result.ok) {
      setProblem(result.error);
      return;
    }
    if (result.value !== null) {
      setPath(result.value);
      setTestedPath(undefined);
      setTestResult(null);
    }
  }

  async function testShell(): Promise<void> {
    setBusy(true);
    setProblem(null);
    setTestResult(null);
    const result = await window.foundry.testShellPath(candidate);
    setBusy(false);
    if (!result.ok) {
      setTestedPath(undefined);
      setProblem(result.error);
      return;
    }
    setTestedPath(candidate);
    setTestResult(result.value);
  }

  async function saveShell(): Promise<void> {
    setBusy(true);
    setProblem(null);
    const result = await window.foundry.saveShellPath(candidate);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.error);
      return;
    }
    const loaded = await window.foundry.loadShellSettings();
    if (loaded.ok) setSnapshot(loaded.value);
    else setProblem(loaded.error);
    setTestedPath(undefined);
    setTestResult(null);
  }

  async function useAutomaticDetection(): Promise<void> {
    setBusy(true);
    setProblem(null);
    const result = await window.foundry.saveShellPath(null);
    if (!result.ok) {
      setBusy(false);
      setProblem(result.error);
      return;
    }
    setPath('');
    setTestedPath(undefined);
    setTestResult(null);
    const loaded = await window.foundry.loadShellSettings();
    if (loaded.ok) setSnapshot(loaded.value);
    else setProblem(loaded.error);
    setBusy(false);
  }

  const detected = snapshot?.configuredPath
    ? `Custom shell: ${snapshot.configuredPath}`
    : snapshot?.resolvedPath
      ? `Automatic detection found: ${snapshot.resolvedPath}`
      : (snapshot?.error ?? 'Checking for a Bash installation…');
  const saveReady = testedPath === candidate && testResult !== null;

  return (
    <>
      <VStack gap={1}>
        <Heading level={2}>Kira’s command line</Heading>
        <Text color="secondary" size="sm">
          Foundry detects Bash automatically. Choose another Bash-compatible executable if you
          prefer a different installation or the detected one does not work.
        </Text>
        <Text color="secondary" size="sm">
          $SHELL in Kira&apos;s Bash commands matches this choice; your login shell is unchanged.
        </Text>
      </VStack>
      <Section padding={4}>
        <VStack gap={3}>
          <Text color="secondary" size="sm">
            {detected}
          </Text>
          <TextInput
            label="Bash executable"
            value={path}
            onChange={(value) => {
              setPath(value);
              setTestedPath(undefined);
              setTestResult(null);
              setProblem(null);
            }}
            placeholder="C:\Program Files\Git\bin\bash.exe"
            description="Select the executable Kira should use for Bash commands."
            size="sm"
          />
          <HStack gap={2}>
            <Button
              label="Browse"
              variant="ghost"
              size="sm"
              isDisabled={busy}
              onClick={() => void browse()}
            />
            <Button
              label={busy ? 'Testing…' : 'Test shell'}
              variant="ghost"
              size="sm"
              isDisabled={busy}
              onClick={() => void testShell()}
            />
            <Button
              label="Save path"
              variant="primary"
              size="sm"
              isDisabled={busy || !saveReady}
              onClick={() => void saveShell()}
            />
          </HStack>
          {testResult === null ? null : (
            <Text color="secondary" size="sm">
              Bash works at {testResult.resolvedPath}. Saving applies it to the next command,
              including in open chats.
            </Text>
          )}
          {snapshot?.configuredPath ? (
            <Button
              label="Use automatic detection"
              variant="ghost"
              size="sm"
              isDisabled={busy}
              onClick={() => void useAutomaticDetection()}
            />
          ) : null}
          {problem === null ? null : (
            <Text color="secondary" size="sm">
              {problem}
            </Text>
          )}
          {snapshot?.error ? (
            <Text color="secondary" size="sm">
              {snapshot.configuredPath
                ? `${snapshot.error} Choose a working Bash executable or use automatic detection.`
                : `${snapshot.error} Install Bash or select an existing executable above.`}
            </Text>
          ) : null}
        </VStack>
      </Section>
    </>
  );
}

/**
 * The account this window is signed in as, and the preferences that will land beside
 * it. What the account decided is deliberately not here: memory is a pane of its own,
 * because it is the one part of Settings whose controls reach the server.
 */
function AccountPane({ user }: { user: AuthUser }) {
  return (
    <>
      <VStack gap={1}>
        <Heading level={2}>Account</Heading>
        <Text color="secondary" size="sm">
          Your Foundry account on this device.
        </Text>
      </VStack>

      <Section padding={4}>
        <HStack gap={3} align="center">
          <Avatar name={user.name} size="lg" />
          <VStack gap={0.5}>
            <Text weight="bold">{user.name}</Text>
            <Text color="secondary" size="sm">
              {user.email}
            </Text>
          </VStack>
        </HStack>
      </Section>

      <Section padding={4}>
        <VStack gap={4}>
          <Heading level={2}>Preferences</Heading>
          <PreferenceRow
            title="Email updates"
            description="Allowance summaries and account alerts"
          />
          <PreferenceRow title="Compact chats" description="A denser conversation list" />
        </VStack>
      </Section>
    </>
  );
}

/**
 * What Kira remembers, and which model works it out.
 *
 * Two settings, both the account's own rather than this machine's — they come from
 * the server and go back to it — so this page asks what was decided rather than
 * holding a copy that could drift from what the chats are actually running on.
 *
 * The suggestions are the server's, and the choice is the person's, which is why
 * the reading keeps them apart: what is drawn as chosen is what somebody chose,
 * and the suggestion is marked as a suggestion. Saving therefore sends only the
 * choice — sending back whatever is in force would pin today's suggestion as their
 * own decision, and a deployment that later named another model would no longer
 * reach them.
 *
 * Memory is not compaction, and the copy says so where it matters: turning this off
 * stops the remembering, and a chat goes on compacting deterministically, with its
 * boundary and its `recall` unchanged.
 */
function MemorySection({ models }: { models: readonly ModelOption[] }) {
  const [held, setHeld] = useState<MemorySettings | null>(null);
  const [asked, setAsked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useMountEffect(() => {
    void window.foundry.loadMemory().then((result) => {
      setHeld(result.ok ? result.value : null);
      setAsked(true);
    });
  });

  /** Write a decision through, and show what the server says is now in force. */
  async function decide(next: MemoryChoice): Promise<void> {
    setBusy(true);
    setProblem(null);

    const saved = await window.foundry.saveMemory(next);

    setBusy(false);
    if (!saved.ok) {
      // The server's own words, where the choice was made: it is the party that
      // knows why it would not take — a model the pool no longer offers, say.
      setProblem(saved.error);
      return;
    }

    setHeld(saved.value);
  }

  // What reflects: their choice, or the suggestion when they have made none. A
  // person who has chosen nothing has nothing selected rather than the first model
  // on the list, because drawing one as chosen would be inventing a decision the
  // next save would then write down as theirs.
  const reflects = reflectingWith(held);

  return (
    <Section padding={4}>
      <VStack gap={4}>
        <VStack gap={1}>
          <Heading level={2}>Memory</Heading>
          <Text color="secondary" size="sm">
            What Kira carries out of a chat and into the ones beside it. This is not compaction:
            every chat is summarised when its window fills, and it is always written from the
            conversation rather than remembered.
          </Text>
        </VStack>

        {!asked ? null : held === null ? (
          <Text color="secondary" size="sm">
            Foundry cannot say what this account decided — sign in, or check that the server is
            reachable.
          </Text>
        ) : (
          <VStack gap={4}>
            <CheckboxInput
              label="Let Kira remember what a chat works out"
              description="Decisions, constraints and corrections, drawn from the conversation and carried into every later summary — this chat's own, and what the rest of its project decided."
              value={held.enabled}
              isLoading={busy}
              changeAction={(enabled) => decide({ enabled, chosen: held.chosen })}
            />

            {models.length === 0 ? (
              <Text color="secondary" size="sm">
                Foundry has no model list to choose from — sign in, or check that the server can
                reach its pool.
              </Text>
            ) : (
              <Selector
                label="Model that draws the conclusions"
                options={models.map((model) => ({
                  value: model.id,
                  label: model.name,
                  ...(model.id === held.recommended ? { description: 'Suggested' } : {}),
                }))}
                value={reflects ?? undefined}
                isDisabled={busy}
                onChange={(chosen) => decide({ enabled: held.enabled, chosen })}
              />
            )}

            <Text color="secondary" size="sm">
              {held.chosen === null
                ? 'Nothing chosen, so the suggested model is what reflects. Nothing the server can read knows what a model costs, so the suggestion is simply the pool’s own first pick — one model call per compaction is what it costs, on a chat that has noticed something.'
                : 'Your own choice. Nothing the server can read knows what a model costs, so there is no cheaper one it could work out — one model call per compaction is what it costs, on a chat that has noticed something.'}
            </Text>

            {problem === null ? null : (
              <Text size="sm" color="secondary">
                {problem}
              </Text>
            )}
          </VStack>
        )}
      </VStack>
    </Section>
  );
}

/** The MCP servers this desktop makes available in global and workspace chats. */
function McpSection({ workspaces }: { workspaces: readonly WorkspaceSummary[] }) {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [asked, setAsked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'global' | 'workspace'>('global');
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [transport, setTransport] = useState<'stdio' | 'streamable-http'>('stdio');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [cwd, setCwd] = useState('');
  const [url, setUrl] = useState('');
  const [environment, setEnvironment] = useState('');
  const [headers, setHeaders] = useState('');
  const [bearerToken, setBearerToken] = useState('');
  const [clearCredentials, setClearCredentials] = useState(false);
  const [toolSelection, setToolSelection] = useState<'all' | string[]>('all');

  useMountEffect(() => {
    let mounted = true;
    void window.foundry.loadMcpServers().then((result) => {
      if (!mounted) return;
      setAsked(true);
      if (result.ok) setServers(result.value);
      else setProblem(result.error);
    });
    return window.foundry.onMcpEvent((next) => {
      if (mounted) setServers(next);
    });
  });

  function clearForm(): void {
    setEditingId(null);
    setName('');
    setScope('global');
    setWorkspaceId(null);
    setTransport('stdio');
    setCommand('');
    setArgs('');
    setCwd('');
    setUrl('');
    setEnvironment('');
    setHeaders('');
    setBearerToken('');
    setClearCredentials(false);
    setToolSelection('all');
  }

  function editServer(server: McpServer): void {
    setEditingId(server.id);
    setName(server.name);
    setScope(server.scope);
    setWorkspaceId(server.workspaceId);
    setTransport(server.transport);
    setCommand(server.command);
    setArgs(server.args.join(' '));
    setCwd(server.cwd ?? '');
    setUrl(server.url ?? '');
    setEnvironment('');
    setHeaders('');
    setBearerToken('');
    setClearCredentials(false);
    setToolSelection(server.toolSelection);
    setProblem(null);
  }

  function replaceServer(next: McpServer): void {
    setServers((current) => [...current.filter((server) => server.id !== next.id), next]);
  }

  async function saveServer(): Promise<void> {
    setProblem(null);
    let credentials: McpCredentialsDraft | undefined;
    try {
      if (clearCredentials) {
        credentials = transport === 'stdio' ? { env: null } : { headers: null, bearerToken: null };
      } else {
        const changed: McpCredentialsDraft = {};
        if (transport === 'stdio' && environment.trim() !== '') {
          changed.env = JSON.parse(environment) as Record<string, string>;
        }
        if (transport === 'streamable-http' && headers.trim() !== '') {
          changed.headers = JSON.parse(headers) as Record<string, string>;
        }
        if (transport === 'streamable-http' && bearerToken !== '') changed.bearerToken = bearerToken;
        if (Object.keys(changed).length > 0) credentials = changed;
      }
    } catch {
      setProblem('Environment variables and headers must be valid JSON objects.');
      return;
    }
    setBusy(true);
    const draft = {
      scope,
      workspaceId: scope === 'workspace' ? workspaceId : null,
      name,
      transport,
      command: transport === 'stdio' ? command : '',
      args: transport === 'stdio' ? args.split(/\s+/u).filter(Boolean) : [],
      cwd: transport === 'stdio' ? cwd.trim() || null : null,
      url: transport === 'streamable-http' ? url.trim() : null,
      toolSelection,
      ...(credentials === undefined ? {} : { credentials }),
    } as const;
    const result = editingId === null
      ? await window.foundry.addMcpServer(draft)
      : await window.foundry.updateMcpServer(editingId, draft);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.error);
      return;
    }
    replaceServer(result.value);
    clearForm();
  }

  async function removeServer(id: string): Promise<void> {
    setBusy(true);
    setProblem(null);
    const result = await window.foundry.removeMcpServer(id);
    setBusy(false);
    if (!result.ok) setProblem(result.error);
    else setServers((current) => current.filter((server) => server.id !== id));
  }

  async function reconnectServer(id: string): Promise<void> {
    setBusy(true);
    setProblem(null);
    const result = await window.foundry.reconnectMcpServer(id);
    setBusy(false);
    if (!result.ok) setProblem(result.error);
  }

  async function changeEnabled(server: McpServer): Promise<void> {
    setBusy(true);
    setProblem(null);
    const result = await window.foundry.setMcpServerEnabled(server.id, !server.enabled);
    setBusy(false);
    if (!result.ok) setProblem(result.error);
  }

  async function changeTools(server: McpServer, next: 'all' | string[]): Promise<void> {
    setBusy(true);
    setProblem(null);
    const result = await window.foundry.setMcpServerToolSelection(server.id, next);
    setBusy(false);
    if (!result.ok) setProblem(result.error);
    else setToolSelection(next);
  }

  async function changeOAuth(server: McpServer, action: 'sign-in' | 'sign-out'): Promise<void> {
    setBusy(true);
    setProblem(null);
    const result = action === 'sign-in'
      ? await window.foundry.signInMcpServer(server.id)
      : await window.foundry.signOutMcpServer(server.id);
    setBusy(false);
    if (!result.ok) setProblem(result.error);
  }

  const editingServer = servers.find((server) => server.id === editingId);
  const groups = [
    { id: 'global', label: 'Global', servers: servers.filter((server) => server.scope === 'global') },
    ...workspaces.map((workspace) => ({
      id: workspace.id,
      label: workspace.name,
      servers: servers.filter((server) => server.workspaceId === workspace.id),
    })),
  ];

  return (
    <>
      <VStack gap={1}>
        <Heading level={2}>MCP servers</Heading>
        <Text color="secondary" size="sm">
          Give Kira tools from Model Context Protocol servers. Global servers are shared by every
          chat; workspace servers are offered only to chats in that workspace.
        </Text>
      </VStack>

      {!asked ? null : (
        <VStack gap={3}>
          {groups.map((group) => (
            <VStack key={group.id} gap={2}>
              <Heading level={2}>{group.label}</Heading>
              {group.servers.length === 0 ? (
                <Text color="secondary" size="sm">No MCP servers in this scope.</Text>
              ) : group.servers.map((server) => {
            const showingTools = expandedId === server.id;
            return (
              <Section key={server.id} padding={4}>
                <VStack gap={2}>
                  <HStack justify="between" align="center">
                    <VStack gap={0.5}>
                      <Text weight="bold">{server.name}</Text>
                      <Text color="secondary" size="sm">
                        {server.transport === 'stdio'
                          ? `${server.command} ${server.args.join(' ')}`
                          : server.url}
                      </Text>
                      {server.transport === 'stdio' ? (
                        <Text color="secondary" size="sm">
                          Working folder: {server.cwd ?? 'inherited'}
                        </Text>
                      ) : null}
                    </VStack>
                    <HStack gap={1}>
                      <Button
                        label={server.status === 'connected' ? 'Reconnect' : 'Connect'}
                        variant="ghost"
                        size="sm"
                        isDisabled={busy || !server.enabled}
                        onClick={() => void reconnectServer(server.id)}
                      />
                      {server.transport === 'streamable-http'
                        && server.enabled
                        && (!server.hasOAuth || server.status === 'needs-sign-in') ? (
                        <Button
                          label="Sign in"
                          variant="ghost"
                          size="sm"
                          isDisabled={busy}
                          onClick={() => void changeOAuth(server, 'sign-in')}
                        />
                      ) : null}
                      {server.hasOAuth || server.oauthCredentialsPersisted ? (
                        <Button
                          label="Sign out"
                          variant="ghost"
                          size="sm"
                          isDisabled={busy}
                          onClick={() => void changeOAuth(server, 'sign-out')}
                        />
                      ) : null}
                      <Button
                        label={server.enabled ? 'Disable' : 'Enable'}
                        variant="ghost"
                        size="sm"
                        isDisabled={busy}
                        onClick={() => void changeEnabled(server)}
                      />
                      <Button
                        label="Edit"
                        variant="ghost"
                        size="sm"
                        isDisabled={busy}
                        onClick={() => editServer(server)}
                      />
                      <Button
                        label="Remove"
                        variant="ghost"
                        size="sm"
                        isDisabled={busy}
                        onClick={() => void removeServer(server.id)}
                      />
                    </HStack>
                  </HStack>
                  <Text color="secondary" size="sm">
                    {server.status} · {server.tools.length} tool{server.tools.length === 1 ? '' : 's'}
                    {server.hasOAuth ? ' · signed in' : ''}
                    {server.oauthCredentialsPersisted && !server.hasOAuth
                      ? ' · encrypted OAuth credentials unavailable'
                      : ''}
                    {server.hasCredentials || server.credentialsPersisted
                      ? server.credentialsPersisted
                        ? server.hasCredentials ? ' · encrypted credentials' : ' · encrypted credentials unavailable'
                        : ' · memory-only credentials'
                      : ''}
                    {server.status === 'failed' && server.error !== null ? ` · ${server.error}` : ''}
                  </Text>
                  <Button
                    label={showingTools ? 'Hide tools' : 'Show tools'}
                    variant="ghost"
                    size="sm"
                    isDisabled={busy}
                    onClick={() => setExpandedId(showingTools ? null : server.id)}
                  />
                  {showingTools ? (
                    <VStack gap={2}>
                      <CheckboxInput
                        label="Use all tools"
                        description="New tools this server adds will be available automatically."
                        value={server.toolSelection === 'all'}
                        isLoading={busy}
                        changeAction={(all) => {
                          const next = all
                            ? 'all'
                            : server.tools.filter((tool) => tool.selected).map((tool) => tool.toolName);
                          void changeTools(server, next);
                        }}
                      />
                      {server.tools.length === 0 ? (
                        <Text color="secondary" size="sm">No tools discovered.</Text>
                      ) : server.tools.map((tool) => (
                        <CheckboxInput
                          key={tool.name}
                          label={tool.toolName}
                          description={tool.description}
                          value={tool.selected}
                          isLoading={busy || server.toolSelection === 'all'}
                          changeAction={(enabled) => {
                            const selected = server.toolSelection === 'all'
                              ? server.tools.map((candidate) => candidate.toolName)
                              : [...server.toolSelection];
                            const next = enabled
                              ? [...new Set([...selected, tool.toolName])]
                              : selected.filter((name) => name !== tool.toolName);
                            void changeTools(server, next);
                          }}
                        />
                      ))}
                    </VStack>
                  ) : null}
                </VStack>
              </Section>
            );
              })}
            </VStack>
          ))}
        </VStack>
      )}

      <Section padding={4}>
        <VStack gap={3}>
          <Heading level={2}>{editingId === null ? 'Add a server' : 'Edit server'}</Heading>
          <Text color="secondary" size="sm">
            Use a local command or a Streamable HTTP MCP URL. Workspace servers are offered only to chats in that workspace.
          </Text>
          <TextInput label="Name" value={name} onChange={setName} size="sm" />
          <Selector
            label="Scope"
            options={[
              { value: 'global', label: 'Global (all chats)' },
              ...workspaces.map((workspace) => ({ value: workspace.id, label: workspace.name })),
            ]}
            value={scope === 'global' ? 'global' : workspaceId ?? undefined}
            onChange={(value) => {
              if (value === 'global') {
                setScope('global');
                setWorkspaceId(null);
              } else {
                setScope('workspace');
                setWorkspaceId(value);
              }
            }}
            isDisabled={busy || workspaces.length === 0 && scope === 'workspace'}
          />
          <Selector
            label="Transport"
            options={[
              { value: 'stdio', label: 'Local command' },
              { value: 'streamable-http', label: 'Streamable HTTP URL' },
            ]}
            value={transport}
            onChange={(value) => setTransport(value as 'stdio' | 'streamable-http')}
            isDisabled={busy}
          />
          {transport === 'stdio' ? (
            <>
              <TextInput label="Command" value={command} onChange={setCommand} size="sm" />
              <TextInput label="Arguments" value={args} onChange={setArgs} size="sm" />
              <TextInput label="Working folder" value={cwd} onChange={setCwd} size="sm" />
              <TextInput
                label="Environment variables (JSON)"
                value={environment}
                onChange={(value) => { setEnvironment(value); setClearCredentials(false); }}
                placeholder={editingId === null ? '{"API_TOKEN":"..."}' : 'Leave blank to keep saved values'}
                description="Protected by OS key storage when available; otherwise kept only until the app closes."
                size="sm"
              />
            </>
          ) : (
            <>
              <TextInput label="MCP URL" value={url} onChange={setUrl} size="sm" />
              <TextInput
                label="HTTP headers (JSON)"
                value={headers}
                onChange={(value) => { setHeaders(value); setClearCredentials(false); }}
                placeholder={editingId === null ? '{"x-api-key":"..."}' : 'Leave blank to keep saved values'}
                description="Protected by OS key storage when available; otherwise kept only until the app closes."
                size="sm"
              />
              <TextInput
                label="Bearer token"
                type="password"
                value={bearerToken}
                onChange={(value) => { setBearerToken(value); setClearCredentials(false); }}
                placeholder={editingId === null ? 'Optional' : 'Leave blank to keep saved token'}
                size="sm"
              />
            </>
          )}
          {editingId !== null && (editingServer?.hasCredentials || editingServer?.credentialsPersisted) ? (
            <HStack justify="between" align="center">
              <Text color="secondary" size="sm">
                {editingServer?.credentialsPersisted
                  ? editingServer.hasCredentials
                    ? 'Credentials are encrypted and never returned to this window.'
                    : 'Encrypted credentials exist but are unavailable on this device.'
                  : 'Credentials are available only until this app closes because this device cannot encrypt them.'}
              </Text>
              <Button
                label={clearCredentials ? 'Keep configured credentials' : 'Clear configured credentials'}
                variant="ghost"
                size="sm"
                isDisabled={busy}
                onClick={() => setClearCredentials(!clearCredentials)}
              />
            </HStack>
          ) : null}
          {clearCredentials ? <Text color="secondary" size="sm">Configured credentials will be cleared when you save.</Text> : null}
          <HStack gap={2}>
            <Button
              label={editingId === null ? 'Add server' : 'Save server'}
              variant="primary"
              size="sm"
              isDisabled={busy || name.trim() === '' || (scope === 'workspace' && workspaceId === null) || (transport === 'stdio' ? command.trim() === '' : url.trim() === '')}
              onClick={() => void saveServer()}
            />
            {editingId === null ? null : (
              <Button label="Cancel" variant="ghost" size="sm" isDisabled={busy} onClick={clearForm} />
            )}
          </HStack>
          {problem === null ? null : <Text color="secondary" size="sm">{problem}</Text>}
        </VStack>
      </Section>
    </>
  );
}
