import type { ChatCommand, MagicPrompt } from '../../preload/bridge';

export type ComposerSubmission =
  | { type: 'message'; text: string }
  | { type: 'shell'; command: string }
  | { type: 'empty-shell' }
  | { type: 'compact' };

export interface RestoredFileReference {
  path: string;
  value: string;
}

/** The readable serialization carried by a file-reference chip and sent to Kira. */
export function fileReferenceValue(path: string): string {
  return `@file(${JSON.stringify(path)})`;
}

/** Read one file-reference serialization at the start of `text`, if it is valid. */
export function restoredFileReference(text: string): RestoredFileReference | null {
  const match = /^@file\(("(?:[^"\\]|\\.)*")\)/u.exec(text);
  if (match === null) return null;

  let path: unknown;
  try {
    path = JSON.parse(match[1]!);
  } catch {
    return null;
  }

  if (typeof path !== 'string' || !isWorkspaceRelativePath(path)) return null;
  return { path, value: match[0] };
}

export function isWorkspaceRelativePath(path: string): boolean {
  return path !== '' && !path.startsWith('/') && !path.split('/').some((part) => part === '..');
}

/** Match shared Magic Prompts by their names and aliases, without changing their text. */
export function matchingMagicPrompts(
  prompts: readonly MagicPrompt[],
  query: string,
): MagicPrompt[] {
  const needle = query.trim().toLocaleLowerCase();
  const matches = prompts.filter((prompt) =>
    [prompt.name, ...prompt.aliases].some((label) => label.toLocaleLowerCase().includes(needle)),
  );

  return matches.sort((one, two) => {
    const rank = (prompt: MagicPrompt): number => {
      const labels = [prompt.name, ...prompt.aliases].map((label) => label.toLocaleLowerCase());
      return labels.some((label) => label === needle)
        ? 0
        : labels.some((label) => label.startsWith(needle))
          ? 1
          : 2;
    };
    return rank(one) - rank(two) || one.name.localeCompare(two.name);
  });
}

export function matchingCommands(
  commands: readonly ChatCommand[],
  query: string,
): ChatCommand[] {
  const needle = query.trim().toLocaleLowerCase();
  return commands.filter((command) =>
    [command.label, command.description, command.invocation].some((value) =>
      value.toLocaleLowerCase().includes(needle),
    ),
  );
}

/** Choose local execution only for a leading `!`; historical edits stay ordinary text. */
export function submissionFor(text: string, isEditing = false): ComposerSubmission {
  if (!isEditing && text.startsWith('!')) {
    const command = text.slice(1);
    return command.trim() === '' ? { type: 'empty-shell' } : { type: 'shell', command };
  }

  if (!isEditing && text.trim() === '/compact') return { type: 'compact' };
  return { type: 'message', text };
}
