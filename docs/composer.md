# Composer shortcuts

Kira's composer understands four leading characters. Type one at the start of a
word and a menu opens where the cursor is; pick an entry with the arrow keys and
Enter, or click it.

| Type | What it opens | What choosing does |
| --- | --- | --- |
| `@` | Files in this chat's workspace. | Inserts a file reference the agent can read. |
| `/` | Commands and skills this chat's session supports. | Writes the command into the draft; it runs when you send. |
| `#` | Magic Prompts — reusable text saved for this installation. | Expands the prompt's text into the draft. |
| `!` | — | Runs the rest of the draft as a local command. |

## `@` — reference a file

Typing `@` searches the chat's workspace by file name and offers the matching
paths. Choosing one drops a reference into the draft. The reference is the
workspace-relative path, and Kira reads the file with her own read tool, so
nothing is pasted into the prompt behind your back. A chat with no workspace yet
(nothing has been said in it) has no files to search.

## `/` — commands and skills

Typing `/` lists the commands and skills the chat's active Pi session knows —
Kira's own actions, any prompt templates the session loaded, and the skills
available to it. Each row names its category (`Commands` or `Skills`). Choosing
one writes its invocation into the draft — nothing runs until you send it.

`/compact` is an action rather than a message: choosing it and sending asks Kira
to summarise the chat now, which is the same summary the automatic compaction
writes and costs nothing from your allowance.

## `#` — Magic Prompts

Typing `#` searches the Magic Prompts saved for this installation. Choosing one
expands its text into the draft, where you can edit it; it is never sent for you.
If no Magic Prompt matches, the menu offers **Manage Magic Prompts**, which opens
**Settings → Magic Prompts**.

Magic Prompts are shared across every project on this installation. Manage them
in **Settings → Magic Prompts**: each has a name, optional aliases (one per
line), and the literal text it expands to. Names and aliases must be unambiguous
across prompts, ignoring case, because either one can be typed after `#`.

## `!` — run a command locally

When `!` is the *first* character of the draft, the rest of the draft is a shell
command, not a message to Kira. The composer shows a **Run** action instead of
**Send**, and the command runs in this chat's working folder using the shell
chosen in **Settings → Shell**.

- The command's output is streamed under the composer while it runs, and the
  finished run — command, output, and exit status — becomes part of the chat.
- Kira records the run as context, so she can read what a command printed in her
  next turn. Running a command does not start a turn and costs nothing from your
  allowance.
- One command runs per chat at a time. **Cancel command** stops it without
  stopping anything Kira is doing.
- Shell mode is refused while Kira is writing, while the chat is being
  summarised, and while you are editing an earlier message; the draft is kept and
  the reason is shown.

An exclamation mark anywhere else is ordinary text: `check this ! later` is a
message, not a command. A bare `!` is refused — there is nothing to run.
