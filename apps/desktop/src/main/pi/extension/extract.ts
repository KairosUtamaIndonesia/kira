/**
 * What a chat was about, read out of what was said in it.
 *
 * Four judgements, each over the same flat list of turns: the goal of the work,
 * the files it touched, the commits it made, and what the person asked for and
 * corrected. They are heuristics, and they are ported from the extraction
 * modules of the reference workspace (github.com/k0valik/pi-blackhole, MIT), whose
 * `[Session Goal]` / `[Files And Changes]` / `[Commits]` / `[User Preferences]`
 * sections this reproduces.
 *
 * Everything here is a pure function of the turns and, where a path is shown,
 * the folder the chat is working in. No pi, no database, no clock — so the same
 * conversation always reads the same way, which is the whole promise of a
 * reconstruction that a model did not write.
 *
 * Two of the reference's habits are deliberately not carried over. It asks git
 * what it has staged, and it parses shell commands to work out which files a
 * `rm` or a `sed -i` altered; both need the filesystem or a subprocess, and both
 * would put facts in front of the model that this function cannot check from
 * what it was given. A file altered by a shell command is therefore not
 * reported, and the summary says what it knows rather than guessing.
 */
import { relative, resolve, sep } from 'node:path';
import type { ToolUse, Turn } from './turn.ts';

// ── Reading the turns ────────────────────────────────────────────────────────

/** CJK ideographs, including the extension A and compatibility ranges. */
const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;

const hasCJK = (text: string): boolean => CJK.test(text);

/**
 * The shortest line worth keeping.
 *
 * CJK carries two to three times as much in a character, so `回退` is a complete
 * instruction where five ASCII characters would be a fragment.
 */
const shortest = (line: string): number => (hasCJK(line) ? 2 : 5);

/** The lines of a turn that said something, stripped of bullets and blank ones. */
function saidLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, '').trim())
    .filter((line) => line !== '');
}

// ── The goal ─────────────────────────────────────────────────────────────────

/**
 * The person changing their mind, in the words they would use.
 *
 * Read only from the opening of a turn: a pasted bug report below a real
 * instruction is full of the words "actually" and "instead", and none of them
 * mean the work has changed.
 */
const CHANGED_PLAN =
  /\b(instead|actually|change of plan|forget that|new task|switch to|now I want|pivot|let'?s do|stop .* and)\b/i;

/** A verb that opens work rather than answering a question about it. */
const ASKS_FOR_WORK =
  /\b(fix|implement|add|create|build|refactor|debug|investigate|update|remove|delete|migrate|deploy|test|write|set up)\b/i;

/** A whole line that acknowledges something without asking for anything. */
const CHATTER = /^(?:ok|okay|yes|no|sure|yeah|yep|go|hi|hey|thx|thanks|y|n|k)\s*[.!?]*$/i;

/**
 * A line that is something other than a person asking for work: a box drawing
 * from a terminal, a pasted code block or function, a bare URL or path.
 */
const NOT_ASKED_FOR =
  /^\s*[│├└─╭╰]|```|^\s*(?:=[A-Z]+\(|function |const |let |var |import |export |class )|^(?:https?:|file:|\/[A-Za-z])|\\n/;

/** How much of a turn is read for a change of plan. */
const LEADING = 200;

/** How long a goal line may be, which is also what keeps a pasted paragraph out. */
const GOAL = 200;

const OPENING_LINES = 6;
const CHANGE_LINES = 3;
const GOALS = 8;

const worthWanting = (line: string): boolean =>
  line.length >= shortest(line) &&
  line.length <= GOAL &&
  !CHATTER.test(line) &&
  !NOT_ASKED_FOR.test(line);

/**
 * What the work is for.
 *
 * The opening of the chat, because that is where a person says what they want,
 * and then any point where they changed their mind. A change of plan is kept as
 * one rather than folded into the goal: a summary that only ever reports the
 * opening line sends Kira back to work that was abandoned three hours ago.
 */
export function goalIn(turns: readonly Turn[]): string[] {
  const goal: string[] = [];
  let changed: string[] | null = null;

  for (const turn of turns) {
    if (turn.speaker !== 'person') continue;

    const lines = saidLines(turn.text).filter(worthWanting);
    if (lines.length === 0) continue;

    if (goal.length === 0) {
      goal.push(...lines.slice(0, OPENING_LINES));
      continue;
    }

    const leading = turn.text.slice(0, LEADING);
    const opening = lines[0];

    if (CHANGED_PLAN.test(leading)) {
      changed = lines.slice(0, CHANGE_LINES);
    } else if (opening !== undefined && ASKS_FOR_WORK.test(leading) && opening.length > 15) {
      changed = lines.slice(0, 2);
    }
  }

  if (changed !== null) goal.push('[Scope change]', ...changed);

  return goal.slice(0, GOALS);
}

// ── What the person asked for ────────────────────────────────────────────────

/**
 * A line that says how the person wants the work done rather than what it is.
 *
 * Deliberately narrow. A bare `always` or `never` appears in ordinary talk, so
 * the patterns built on those need the verb they are directing; the rest are
 * constructions that are a preference or a correction by their shape — a
 * preference verb with an object, a `style:` field, a `that's wrong`, a revert.
 * The CJK markers have no word boundaries to lean on, so they are taken from
 * unambiguous directives only; conversational hedges like 不行 and 不对 are left
 * out because they turn up in chatter.
 */
const PREFERS = [
  /\bprefer(?:s|red|ring)?\s+\w/i,
  /\bdon'?t want\b/i,
  /\balways (?:use|do|run|prefer|keep|make|format|write|add|set|put|prefix|start|include|append)\b/i,
  /\bnever (?:use|do|run|push|commit|write|ignore|add|set|put|remove|delete|include|deploy)\b/i,
  /\bplease (?:use|avoid|keep|make|don'?t|do not|format|write)\b/i,
  /\b(?:style|format|language|naming)\s*[:=]\s*\S/i,
  /\bstop (?:doing|using|adding|running|writing|committing|pushing)\b/i,
  /\b(?:that's|this is) wrong\b/i,
  /\b(?:revert|undo) (?:that|this|the|it|your)\b/i,
  /不要|不用|别再|回退|错了|停止/,
  /以后|下次|必须|记住(?!了|吧|哦)/,
];

const ASKING_START = /^(?:what|where|when|who|whom|whose|why|how|which)\b/i;

/**
 * CJK interrogatives, matched anywhere: CJK fronts a time scope before the
 * question word — 以后怎么提交代码？ opens with a standing-instruction marker and
 * is still a question.
 */
const ASKING_CJK = /为什么|怎么|如何|什么|哪里|哪儿|哪个|哪些|怎样|咋/;

const PREFERENCE = 200;
const PREFERENCES = 10;

/**
 * Whether a line asks for information rather than directing work.
 *
 * "What do you prefer here?" holds a preference verb and is not a preference.
 * A directive phrased as a question — "Can you always run the tests?" — opens
 * with a modal, so it survives.
 */
function asks(line: string): boolean {
  // Paired quotes come off first: a quoted question ends with a quote rather
  // than with the question mark that says it is one.
  const asked = line.replace(/^[“‘"'「『]+/, '').replace(/[”’"'」』]+$/, '');
  if (!asked.endsWith('?') && !asked.endsWith('？')) return false;

  return ASKING_START.test(asked) || ASKING_CJK.test(asked);
}

/** What the person asked for, and what they corrected. */
export function preferencesIn(turns: readonly Turn[]): string[] {
  const found: string[] = [];
  const seen = new Set<string>();

  for (const turn of turns) {
    if (turn.speaker !== 'person') continue;

    for (const line of saidLines(turn.text)) {
      if (line.length < shortest(line) || line.length > PREFERENCE) continue;
      if (asks(line)) continue;
      if (!PREFERS.some((pattern) => pattern.test(line))) continue;

      const key = line.toLowerCase();
      if (seen.has(key)) continue;

      seen.add(key);
      found.push(line);
      // One per turn: a turn holding a pasted list of house rules is one
      // instruction and not eight.
      break;
    }
  }

  return found.slice(0, PREFERENCES);
}

// ── Files and changes ────────────────────────────────────────────────────────

/**
 * The tools that alter a file, and the ones that only look.
 *
 * pi's own names, which is all a chat can reach today. `view`, `cat`, `edit_file`
 * and the rest are left out rather than guessed at: a file reported as altered
 * when it was only read sends the next session somewhere it never went, which is
 * worse than a file it does not name. This is where to add a name if a tool
 * Foundry did not write ever needs one.
 */
const ALTERS = new Set(['write', 'edit']);
const LOOKS = new Set(['read']);

const CHANGED_FILES = 20;
const READ_FILES = 10;

/** What the work touched: the files it altered, and the files it read. */
export interface FileActivity {
  changed: readonly string[];
  read: readonly string[];
}

/**
 * A file as the summary should name it.
 *
 * Tool arguments arrive as whatever the model typed: quotes or brackets around
 * the path, a comma after it, an editor's `:12` / `:10-40` / `#L12` suffix. All
 * of those mean the same file, and left alone they sit in the summary as
 * several phantom files nobody can act on.
 *
 * What survives is named relative to the folder the chat works in, and in full
 * when it is outside that folder — a scratch file in /tmp is worth naming as
 * one rather than as three levels of `..`.
 */
function shown(raw: string, cwd?: string): string {
  const cleaned = unsuffixed(unwrapped(raw));
  if (cleaned === '') return '';

  const path = cleaned.replaceAll('\\', '/');
  if (cwd === undefined) return path;

  const reached = relative(cwd, resolve(cwd, path)).replaceAll(sep, '/');
  if (reached === '' || reached === '..' || reached.startsWith('../')) return path;

  return reached;
}

/** A path with the quotes, brackets and trailing punctuation a tool may hand over. */
function unwrapped(value: string): string {
  return value
    .trim()
    .replace(/^["'`(<[]+/, '')
    .replace(/[>"'`,;).\]\\]+$/, '')
    .replace(/[.,;:]+$/, '');
}

/**
 * A path with an editor's line or range suffix taken off.
 *
 * The colon has to be told apart from a Windows drive letter and from a colon
 * inside a folder's name, so only a colon in the last segment of the path,
 * followed by nothing but digits and further colons, is read as one. Anything
 * before the last separator is left alone, which is what keeps `C:/repo/a.ts`
 * and `notes:2026/a.ts` whole.
 */
function unsuffixed(value: string): string {
  if (!value.includes('#') && !value.includes(':')) return value;

  const withoutHash = value.replace(/#L\d+(?:C\d+)?$/i, '').replace(/:\d+-\d+$/, '');
  const lastSeparator = Math.max(withoutHash.lastIndexOf('/'), withoutHash.lastIndexOf('\\'));
  const colon = withoutHash.indexOf(':', lastSeparator + 1);

  return colon > lastSeparator && /^\d+(?::\d+)?$/.test(withoutHash.slice(colon + 1))
    ? withoutHash.slice(0, colon)
    : withoutHash;
}

/** Which file a tool was aimed at, when it was aimed at one. */
const aimedAt = (tool: ToolUse, cwd?: string): string =>
  tool.path === undefined ? '' : shown(tool.path, cwd);

/**
 * The files the work touched.
 *
 * Read off the tools Kira reached for, in the order she reached for them, so
 * the cap keeps what she touched last rather than what she happened to open
 * first. A file she altered is never also reported as one she read: the summary
 * is a list of files, and one path under two headings reads as two files.
 */
export function filesIn(turns: readonly Turn[], cwd?: string): FileActivity {
  const changed = new Set<string>();
  const read = new Set<string>();

  for (const turn of turns) {
    if (turn.speaker !== 'kira') continue;

    for (const tool of turn.tools ?? []) {
      const path = aimedAt(tool, cwd);
      if (path === '') continue;

      const name = tool.name.toLowerCase();
      if (ALTERS.has(name)) changed.add(path);
      else if (LOOKS.has(name)) read.add(path);
    }
  }

  for (const path of changed) read.delete(path);

  return {
    changed: [...changed].reverse().slice(0, CHANGED_FILES),
    read: [...read].reverse().slice(0, READ_FILES),
  };
}

// ── Commits ──────────────────────────────────────────────────────────────────

/**
 * A commit, as git prints one as it makes it.
 *
 * `[main a1b2c3d] refresh the token` — a branch, a hash, the subject. Only this
 * bracketed form is read. `a1b2c3d refresh the token` is what `git log --oneline`
 * prints and also what a test runner, a package manager and a lockfile print,
 * so matching it would fill the summary with things that were never committed.
 */
const MADE_A_COMMIT = /\[(?:[^\]\n]*\s)?([0-9a-f]{7,12})\]\s+(.+)/g;

const COMMITS = 10;

/** The commits made during the work. */
export function commitsIn(turns: readonly Turn[]): string[] {
  const found: string[] = [];
  const seen = new Set<string>();

  for (const turn of turns) {
    if (turn.speaker !== 'tool') continue;

    for (const match of turn.text.matchAll(MADE_A_COMMIT)) {
      const hash = match[1];
      const subject = match[2];
      if (hash === undefined || subject === undefined) continue;
      if (seen.has(hash)) continue;

      seen.add(hash);
      found.push(`${hash}: ${subject.trim()}`);
    }
  }

  return found.slice(0, COMMITS);
}
