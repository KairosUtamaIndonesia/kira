# The workbench asks git what to hide, rather than matching .gitignore itself

Date: 2026-09-21

## Context

The Workbench shows a chat's workspace as a tree, and a tree that lists `node_modules` is not
a tree anyone can use. So it respects `.gitignore` by default, with a control to reveal what is
hidden — and that decision looks like it requires a gitignore matcher. Matching correctly means
nested per-directory files, negation, directory-only patterns, `.git/info/exclude` and
`core.excludesFile`, and a matcher that gets any one of those wrong hides the wrong files
silently.

Both obvious answers were measured and both came out worse. The Rust `ignore` crate is the
canonical implementation and has no napi binding published, so using it means shipping a
sidecar binary per platform to sign and notarise — and `fd` and `rg` answer a different
question anyway. A pure-Node matcher — `ignore@7` plus a
per-directory cascade — is roughly 200 lines we would own and maintain, and it cannot read
`info/exclude` or `core.excludesFile` at all. Pruning during a hand-rolled descent rather than
filtering after it still cost 289–423 ms and 10–18 MB of heap on real checkouts.

## Decision

**The filtered tree is git's answer, not ours.** `git ls-files -co --exclude-standard -z`, run in
the chat's folder so the answer is scoped to it and the paths come back relative to it, names every
file that is not hidden; the ignored roots
come from `git ls-files -o -i --exclude-standard --directory -z`, and expanding one is the same
query limited to that directory. Both are correct by construction because they are git: nested
`.gitignore`, negation, directory-only patterns, `info/exclude` and `core.excludesFile` all
arrive with `--exclude-standard`.

**Foundry owns no gitignore matcher.** When git cannot answer — it is absent, or the folder is
not a checkout — the tree shows the folder unfiltered and says so. A folder that is not a
checkout gets no git affordances at all, not even disabled ones, and Foundry does not
initialise a repository in it.

## Consequences

**Measured on three real checkouts:** 3–15 ms for the visible set (9 ms on Foundry itself) and
4 ms for the ignored roots, against 289–423 ms and 10–18 MB for a pruned Node walk of the same
trees. The cost does not grow with the size of what is hidden — 9 ms whether `node_modules`
holds 61,776 files or none — because the expensive part is `readdir`, and git does not do one.

**The tree and the reveal control are two views of one answer, not two enumerations.** On this
repo the visible set (414) and the ignored set (63,993) are disjoint and sum to the 64,407 files
a raw walk finds. Revealing does not force a second walk: it names the ignored roots in 4 ms and
pays for a subtree only if someone opens it.

**Directories are derived from the file list, so an empty directory does not appear.** This is
the gap git already has — git cannot track an empty directory either — so the tree and git
agree, rather than merely looking similar.

**`check-ignore --stdin` is not the tool**, at 327 ms–4.2 s over the same paths, and git's own
documentation warns that its string-level behaviour diverges from traversal for directory
patterns.

**The cost is roughly 100–150 lines we own** — a spawn, a split on NUL, two path lists, and one
cache the watcher invalidates — with no native code and no packaging change in an app that today
has neither. The calls go through `simple-git`, which is a way of running the same binary rather
than a second git: it spawns `git` and parses what comes back, so the answers are still git's own
and the dependency is one npm package rather than a git implementation of our own.

**Revisit if** a machine without a runnable git turns up in the field. That is the day the
`node-ignore` cascade earns its ~200 lines. Until then an unfiltered tree is loud rather than
wrong, and this ADR records that we chose it.
