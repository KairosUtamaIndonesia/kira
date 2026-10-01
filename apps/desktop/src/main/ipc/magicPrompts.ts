import {
  MAGIC_PROMPT_CHANNELS,
  type MagicPrompt,
  type MagicPromptDraft,
  type Result,
} from '../../preload/bridge.ts';
import { envelope, isId } from './result.ts';

export { MAGIC_PROMPT_CHANNELS };

export interface MagicPromptHandlers {
  load(): Promise<Result<MagicPrompt[]>>;
  create(draft: unknown): Promise<Result<MagicPrompt>>;
  update(id: unknown, draft: unknown): Promise<Result<MagicPrompt>>;
  remove(id: unknown): Promise<Result<null>>;
}

export interface MagicPromptDeps {
  list(): MagicPrompt[];
  create(draft: MagicPromptDraft): MagicPrompt | Promise<MagicPrompt>;
  update(id: string, draft: MagicPromptDraft): MagicPrompt | undefined | Promise<MagicPrompt | undefined>;
  remove(id: string): void | Promise<void>;
}

export function magicPromptHandlers({ list, create, update, remove }: MagicPromptDeps): MagicPromptHandlers {
  return {
    load: () => envelope(() => list()),

    create: (draft) => {
      const valid = draftIn(draft);
      if (valid === null) {
        return Promise.resolve({ ok: false, error: 'That is not a valid Magic Prompt.' });
      }
      return envelope(() => create(valid));
    },

    update: (id, draft) => {
      if (!isId(id)) {
        return Promise.resolve({ ok: false, error: 'A Magic Prompt needs an id to be updated.' });
      }
      const valid = draftIn(draft);
      if (valid === null) {
        return Promise.resolve({ ok: false, error: 'That is not a valid Magic Prompt.' });
      }
      return envelope(async () => {
        const saved = await update(id, valid);
        if (saved === undefined) throw new Error('That Magic Prompt does not exist.');
        return saved;
      });
    },

    remove: (id) => {
      if (!isId(id)) {
        return Promise.resolve({ ok: false, error: 'A Magic Prompt needs an id to be removed.' });
      }
      return envelope(async () => {
        await remove(id);
        return null;
      });
    },
  };
}

function draftIn(value: unknown): MagicPromptDraft | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const asked = value as { name?: unknown; aliases?: unknown; content?: unknown };
  if (typeof asked.name !== 'string' || asked.name.trim() === '') return null;
  if (typeof asked.content !== 'string' || asked.content.trim() === '') return null;
  if (!Array.isArray(asked.aliases) || !asked.aliases.every((alias) => typeof alias === 'string')) {
    return null;
  }
  return {
    name: asked.name.trim(),
    aliases: [...asked.aliases],
    content: asked.content,
  };
}
