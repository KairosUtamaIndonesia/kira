# A chat's open files are the chat's, not the workspace's

Date: 2026-09-21

## Context

The Workbench shows a chat's workspace: a file tree, and the files opened from it in tabs. A
workspace is not a chat's private property — a project is one folder worked from many chats, so
two chats filed under one project show an identical tree. Nothing about the folder says whose
tabs should appear beside it.

## Decision

**Open files belong to the chat, and are stored in the chat's own record.** The record holds the
paths and which of them is active; a path that no longer resolves when the chat is opened is
dropped without ceremony, because a tab is one click to recreate and a row that can never load
anything is litter. Two chats working in one folder therefore show the same tree with different
files open.

**The panel's width and whether it is showing belong to the window**, the way the sidebar's
width already does (`useResizable` with an `autoSaveId`). Your screen layout is not a property
of a conversation, and opening a file in one chat must not rearrange another.

## Consequences

**Keying the tabs by folder was the alternative, and its cost is real.** It would have kept your
place while moving between two chats that work the same files — the case that actually happens
on a project — and the same file could never be open twice. Choosing the chat instead means
switching between two of a project's chats loses your place, and one path can have a tab in each
of them. That is the trade accepted here.

**The chat's record now holds view state**, so this needs a schema migration and a write on
every tab open and close. That is the price of the tabs surviving a restart, taken over window
memory, which was the smaller change and lost them whenever the window closed.

**Revisit if** the same file open in two chats turns out to be the common case rather than the
rare one. That is the observation that would make per-folder ownership right, and it would show
up as two tabs for one path in two chats.
