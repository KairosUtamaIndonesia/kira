import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Section } from '@astryxdesign/core/Section';
import { Selector } from '@astryxdesign/core/Selector';
import { TextArea } from '@astryxdesign/core/TextArea';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { useEffect, useState } from 'react';
import {
  reflectingWith,
  type AuthUser,
  type DesktopUpdateSnapshot,
  type MagicPrompt,
  type MagicPromptDraft,
  type MemoryChoice,
  type MemorySettings,
  type ModelOption,
  type ShellSettingsSnapshot,
  type ShellTestResult,
  type WorkspaceSummary,
} from '../../preload/bridge';
import { canCheckDesktopUpdate, desktopUpdateStatusText } from './desktop-update-status';
import { GitHostsSection } from './gitHostsSection';
import { McpSection } from './mcpSection';

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
export type Setting =
  | 'account'
  | 'git-hosts'
  | 'memory'
  | 'magic-prompts'
  | 'mcp'
  | 'updates'
  | 'shell';

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
  /** The models Kira offers, read once by the shell, because every chat shares them. */
  models: readonly ModelOption[];
  /** Workspaces are the scopes Settings groups MCP servers under. */
  workspaces: readonly WorkspaceSummary[];
  /** Which pane the rail has selected. */
  showing: Setting;
}) {
  return (
    <VStack gap={6} padding={6} maxWidth={showing === 'git-hosts' || showing === 'mcp' ? 960 : 640}>
      <Heading level={1}>Settings</Heading>

      {showing === 'account' ? (
        <AccountPane user={user} />
      ) : showing === 'git-hosts' ? (
        <GitHostsSection />
      ) : showing === 'memory' ? (
        <MemorySection models={models} />
      ) : showing === 'magic-prompts' ? (
        <MagicPromptsSection />
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

/** Reusable literal text shared by chats in every workspace on this installation. */
function MagicPromptsSection() {
  const [prompts, setPrompts] = useState<MagicPrompt[]>([]);
  const [asked, setAsked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [aliases, setAliases] = useState('');
  const [content, setContent] = useState('');

  useMountEffect(() => {
    void window.kira.loadMagicPrompts().then((result) => {
      setAsked(true);
      if (result.ok) setPrompts(result.value);
      else setProblem(result.error);
    });
  });

  function clearForm(): void {
    setEditingId(null);
    setName('');
    setAliases('');
    setContent('');
    setProblem(null);
  }

  function editPrompt(prompt: MagicPrompt): void {
    setEditingId(prompt.id);
    setName(prompt.name);
    setAliases(prompt.aliases.join('\n'));
    setContent(prompt.content);
    setProblem(null);
  }

  async function savePrompt(): Promise<void> {
    setProblem(null);
    if (name.trim() === '') {
      setProblem('Enter a name for this Magic Prompt.');
      return;
    }
    if (content.trim() === '') {
      setProblem('Add the text this Magic Prompt should expand to.');
      return;
    }

    const draft: MagicPromptDraft = {
      name: name.trim(),
      aliases: aliases
        .split(/\r?\n/u)
        .map((alias) => alias.trim())
        .filter(Boolean),
      content,
    };
    setBusy(true);
    const result =
      editingId === null
        ? await window.kira.createMagicPrompt(draft)
        : await window.kira.updateMagicPrompt(editingId, draft);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.error);
      return;
    }

    setPrompts((current) =>
      editingId === null
        ? [...current, result.value]
        : current.map((prompt) => (prompt.id === result.value.id ? result.value : prompt)),
    );
    clearForm();
  }

  async function removePrompt(id: string): Promise<void> {
    setBusy(true);
    setProblem(null);
    const result = await window.kira.removeMagicPrompt(id);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.error);
      return;
    }
    setPrompts((current) => current.filter((prompt) => prompt.id !== id));
    if (editingId === id) clearForm();
    setDeletingId(null);
  }

  const deletingPrompt = prompts.find((prompt) => prompt.id === deletingId);

  return (
    <>
      <VStack gap={1}>
        <Heading level={2}>Magic Prompts</Heading>
        <Text color="secondary" size="sm">
          Save reusable text for every chat on this installation. Choosing a prompt inserts editable
          text into the composer; it never sends it for you.
        </Text>
      </VStack>

      {!asked ? (
        <Text color="secondary" size="sm">
          Loading Magic Prompts…
        </Text>
      ) : prompts.length === 0 ? (
        <Text color="secondary" size="sm">
          No Magic Prompts yet. Add one below.
        </Text>
      ) : (
        <VStack gap={2}>
          {prompts.map((prompt) => (
            <Section key={prompt.id} padding={4}>
              <HStack justify="between" align="center">
                <VStack gap={0.5}>
                  <Text weight="bold">{prompt.name}</Text>
                  {prompt.aliases.length === 0 ? null : (
                    <Text color="secondary" size="sm">
                      Aliases: {prompt.aliases.join(', ')}
                    </Text>
                  )}
                  <Text color="secondary" size="sm">
                    {prompt.content.length > 160
                      ? `${prompt.content.slice(0, 160)}…`
                      : prompt.content}
                  </Text>
                </VStack>
                <HStack gap={1}>
                  <Button
                    label="Edit"
                    variant="ghost"
                    size="sm"
                    isDisabled={busy}
                    onClick={() => editPrompt(prompt)}
                  />
                  <Button
                    label="Delete"
                    variant="ghost"
                    size="sm"
                    isDisabled={busy}
                    onClick={() => setDeletingId(prompt.id)}
                  />
                </HStack>
              </HStack>
            </Section>
          ))}
        </VStack>
      )}

      <Section padding={4}>
        <VStack gap={3}>
          <Heading level={2}>
            {editingId === null ? 'Add a Magic Prompt' : 'Edit Magic Prompt'}
          </Heading>
          <TextInput label="Name" value={name} onChange={setName} size="sm" />
          <TextArea label="Aliases (one per line)" value={aliases} onChange={setAliases} rows={2} />
          <TextArea label="Prompt text" value={content} onChange={setContent} rows={8} />
          {problem === null ? null : (
            <Text color="secondary" size="sm">
              {problem}
            </Text>
          )}
          <HStack gap={2}>
            <Button
              label={editingId === null ? 'Add Magic Prompt' : 'Save Magic Prompt'}
              variant="primary"
              size="sm"
              isDisabled={busy}
              onClick={() => void savePrompt()}
            />
            {editingId === null ? null : (
              <Button
                label="Cancel"
                variant="ghost"
                size="sm"
                isDisabled={busy}
                onClick={clearForm}
              />
            )}
          </HStack>
        </VStack>
      </Section>

      {deletingPrompt === undefined ? null : (
        <AlertDialog
          isOpen
          onOpenChange={(open) => {
            if (!open) setDeletingId(null);
          }}
          title="Delete this Magic Prompt?"
          description={`“${deletingPrompt.name}” will be removed from every workspace. This cannot be undone.`}
          actionLabel="Delete prompt"
          onAction={() => void removePrompt(deletingPrompt.id)}
        />
      )}
    </>
  );
}

/** The packaged desktop's release check and downloaded update. */
function UpdatesSection() {
  const [snapshot, setSnapshot] = useState<DesktopUpdateSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useMountEffect(() => {
    let mounted = true;
    const unsubscribe = window.kira.onDesktopUpdateEvent((next) => {
      if (mounted) setSnapshot(next);
    });
    void window.kira.loadDesktopUpdate().then((result) => {
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
    const result = await window.kira.checkDesktopUpdate();
    setBusy(false);
    if (result.ok) setSnapshot(result.value);
    else setProblem(result.error);
  }

  async function install(): Promise<void> {
    setBusy(true);
    setProblem(null);
    const result = await window.kira.installDesktopUpdate();
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
          Kira checks for updates automatically and downloads them in the background.
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
    void window.kira.loadShellSettings().then((result) => {
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
    const result = await window.kira.browseShellPath();
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
    const result = await window.kira.testShellPath(candidate);
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
    const result = await window.kira.saveShellPath(candidate);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.error);
      return;
    }
    const loaded = await window.kira.loadShellSettings();
    if (loaded.ok) setSnapshot(loaded.value);
    else setProblem(loaded.error);
    setTestedPath(undefined);
    setTestResult(null);
  }

  async function useAutomaticDetection(): Promise<void> {
    setBusy(true);
    setProblem(null);
    const result = await window.kira.saveShellPath(null);
    if (!result.ok) {
      setBusy(false);
      setProblem(result.error);
      return;
    }
    setPath('');
    setTestedPath(undefined);
    setTestResult(null);
    const loaded = await window.kira.loadShellSettings();
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
          Kira detects Bash automatically. Choose another Bash-compatible executable if you prefer a
          different installation or the detected one does not work.
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
          Your Kira account on this device.
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
    void window.kira.loadMemory().then((result) => {
      setHeld(result.ok ? result.value : null);
      setAsked(true);
    });
  });

  /** Write a decision through, and show what the server says is now in force. */
  async function decide(next: MemoryChoice): Promise<void> {
    setBusy(true);
    setProblem(null);

    const saved = await window.kira.saveMemory(next);

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
            Kira cannot say what this account decided — sign in, or check that the server is
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
                Kira has no model list to choose from — sign in, or check that the server can reach
                its pool.
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
