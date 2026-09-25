# Making the Workbench file tree fast

Date: 2026-09-21
Status: research for the Workbench panel — a file tree of the chat's working folder
(a git checkout) with a read-only text preview in tabs. Two decisions are already
made and shape everything below: the tree **respects `.gitignore` by default**, and
there is a control to **reveal ignored files**.

Terminology follows `CONTEXT.md`: **folder** is the checkout the agent works in
(`CONTEXT.md:73`). "Walk" means listing the folder to build the tree.

## Bottom line

**Ask git.** `git ls-files -co --exclude-standard` returns the non-ignored set with
git's own semantics — nested `.gitignore`, negation, directory-only patterns,
`.git/info/exclude` and `core.excludesFile` all included — in one process, measured at
**3–15 ms** on real checkouts of 243–5,248 files and 9 ms on this repo. The reveal
control is the same command's mirror image: `git ls-files -o -i --exclude-standard
--directory` names the ignored entries in **3–20 ms**, and expanding one pays only for
that subtree (107 ms for all 63,180 files under `node_modules/`). Together the two
queries **partition the working tree exactly** — on this repo 414 + 63,993 = 64,407,
which is the count a raw `readdir` walk finds, with an empty intersection. No new
dependency, no native code, no gitignore matcher we own and maintain.

The honest cost of the "simple" pure-Node option is the alternative: `ignore@7` plus a
cascade we write. It is 23/24 on the gitignore spec cases I ran, but it reads neither
`.git/info/exclude` nor `core.excludesFile`, and it defaults to case-_insensitive_
matching where git is case-sensitive on Linux. That is roughly 200 lines we own, and it
is what we fall back to when `git` is missing or the folder is not a checkout.

The strongest fact against the recommendation is that `git` may not be there: `/usr/bin/git`
on macOS is a shim that can raise the Command Line Tools installer prompt, and on Windows
git may simply be absent. That is why GitHub Desktop ships its own git binary
(`desktop/dugite`). Kira has not committed to bundling one, so the fallback is part of
the recommendation, not an afterthought.

Watch with Node's own `fs.watch(dir, { recursive: true })`, debounced — recursive watching
has been supported on Linux since Node 19.1.0 and Electron 44.4.1 bundles Node 24.21.0.
Adding `@parcel/watcher` buys throttling we can do in ten lines and costs a C++ prebuild,
a dynamic `require` of a platform package, and an `asarUnpack` decision.

## 1. The pure Node baseline

`node:fs` is Stability 2 (Stable) as a module
(<https://github.com/nodejs/node/blob/v24.x/doc/api/fs.md>). Nothing used below carries an
Experimental marker — the three Stability 1 APIs in that file are `filehandle.pull`,
`filehandle.pullSync` and `fs.Utf8Stream`.

| API                                   | signature                                                                                                                  |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `fs.readdir(path[, options])`         | `options`: `encoding`, `withFileTypes` (v10.11.0), `recursive` (v20.1.0 / v18.17.0)                                        |
| `fs.opendir(path[, options])`         | `options`: `encoding`, `bufferSize` (default 32), `recursive` (v20.1.0 / v18.17.0)                                         |
| `fsPromises.readdir(path[, options])` | same options as `fs.readdir`; fulfils with names or `fs.Dirent` objects when `withFileTypes` is set                        |
| `fsPromises.opendir(path[, options])` | fulfils with an `fs.Dir`; async-iterable, auto-closed when the iterator exits                                              |
| `fsPromises.glob(pattern[, options])` | `cwd`, `exclude` (function or glob list, v22.14.0), `followSymlinks` (v24.16.0), `withFileTypes`; **stable as of v24.0.0** |

Sources: the `fs.readdir` / `fs.opendir` / `fsPromises.opendir` / `fsPromises.glob` sections of
<https://github.com/nodejs/node/blob/v24.x/doc/api/fs.md>, and `fs.Dirent` in the same file.

`fs.Dirent` carries a documented caveat that matters for a tree: "the file type of each
entry is the type reported by the operating system and may depend on the file system; for
example, some file systems may report a type that differs from what `fs.lstat()` returns.
Node.js calls `fs.lstat()` on such an entry only when the reported type is unknown."
(<https://github.com/nodejs/node/blob/v24.x/doc/api/fs.md>, `Class: fs.Dirent`).

### Where recursive `readdir` stops

Read the implementation rather than the prose. `readdirRecursive` in `lib/fs.js` keeps
`context.pathsQueue` and `context.readdirResults` and pushes every descendant into one
array; on any error it calls `callback(err)` and abandons the walk
(<https://github.com/nodejs/node/blob/v24.x/lib/fs.js>, `readdirRecursive`, lines 1433–1465).

Three consequences:

- **No prune hook.** Every entry of every directory is materialised, so ignoring has to
  happen after the fact. There is no `filter` option and no abort signal.
- **One error ends the walk.** A single `EACCES` or `ENOENT` anywhere fails the whole call.
- **Symlinked directories are not descended.** Measured: with `tree/link -> real/sub`, the
  recursive listing yields `tree/link` and stops; `opendir`-based traversal only descends if
  you `stat` the entry yourself.

`fs.glob` has an `exclude` option, but its own docs say negation patterns (`!foo.js`) are
not supported — which is the whole point of gitignore's `!` — so it cannot carry the
matching rules. It is useful for scoped listing, not for deciding what is ignored.

### Measured cost, raw Node

`node --expose-gc`, Linux, Node 26.5.0 (Electron 44.4.1 bundles Node 24.21.0), on
`/home/brandon/Workspace/kira` — 1,396 files outside `node_modules`, 72,431 directory
entries in total, `node_modules` 993 MB:

| approach                                              | time   | heap  | entries kept |
| ----------------------------------------------------- | ------ | ----- | ------------ |
| `readdir(root, {recursive:true, withFileTypes:true})` | 423 ms | +10MB | 72,431       |
| `opendir` level by level, sequential                  | 987 ms | +8MB  | 72,430       |
| level by level, pruning `node_modules`/`.git`         | 7 ms   | +1MB  | 979          |
| recursive `readdir`, then filter out ignored paths    | 358 ms | +18MB | 979          |
| level by level, prune, 32 concurrent `readdir` calls  | 2 ms   | +1MB  | 979          |

The last two rows are the load-bearing ones. **Filtering after the fact costs what walking
everything costs** (358 ms for 979 useful entries, versus 7 ms when the prune happens during
descent). And concurrency matters more than any matcher: the same pruned walk goes from 9 ms
to 2 ms at a pool of 32.

## 2. What correct gitignore matching actually requires

The rules below are git's own, from <https://git-scm.com/docs/gitignore>.

**Sources and precedence**, highest first: command-line patterns; `.gitignore` in the file's
own directory and in every parent up to the top of the working tree, "with patterns in the
higher level files being overridden by those in lower level files"; `$GIT_COMMON_DIR/info/exclude`;
then the file named by `core.excludesFile`. "Within one level of precedence, the last matching
pattern decides the outcome." Patterns outside the working tree — `info/exclude` and
`core.excludesFile` — "are treated as if they are specified at the root of the working tree,
i.e. a leading `/` in such patterns anchors the match at the root of the repository."
`core.excludesFile` defaults to `$XDG_CONFIG_HOME/git/ignore`, or `$HOME/.config/git/ignore`.

**Anchoring.** "If there is a separator at the beginning or middle (or both) of the pattern,
then the pattern is relative to the directory level of the particular `.gitignore` file
itself. Otherwise the pattern may also match at any level below the `.gitignore` level."
Concretely: `doc/frotz` and `/doc/frotz` are equivalent in a `.gitignore` (a middle slash
already anchors), but `foo/` matches both `foo/` and `a/foo/`.

**Directory-only.** "If there is a separator at the end of the pattern then the pattern will
only match directories" — `foo/` matches the directory `foo` and paths underneath it but not
a regular file or symlink named `foo`.

**Negation, and the parent-directory trap.** An optional `!` prefix negates. But: "It is not
possible to re-include a file if a parent directory of that file is excluded. Git doesn't
list excluded directories for performance reasons, so any patterns on contained files have no
effect, no matter where they are defined." A `!` can therefore only rescue a path whose
ancestors are all still reachable. This is the rule every naive matcher gets wrong, because
it is a property of the _walk_, not of the pattern.

**Glob shapes.** `*` matches anything except `/`; `?` matches one character except `/`;
`[...]` is a range; `\` escapes. `**` has three meanings: leading `**/foo` matches `foo`
anywhere; trailing `abc/**` matches everything inside `abc` at infinite depth; `a/**/b`
matches `a/b`, `a/x/b`, `a/x/y/b`. "Other consecutive asterisks are considered regular
asterisks."

**Whitespace and comments.** A blank line matches nothing; `#` starts a comment unless
escaped as `\#`; trailing spaces are ignored unless escaped as `\ `.

**Ignored is not untracked.** gitignore's stated purpose "is to ensure that certain files not
tracked by Git remain untracked", and "Files already tracked by Git are not affected". A file
can be both ignored and tracked (added with `git add -f`), in which case it appears in the
tree and in `git status` but is hidden from a fresh `git status --ignored`-style enumeration.
A tree that derives "what to show" purely from the ignored set will drop those files; a tree
derived from git's own index and working-directory listing will not.

**Case.** git is case-sensitive unless the repository sets `core.ignorecase`. `ignore@7`'s own
README states its default is the opposite: "`ignore` is case-insensitive unless you pass
`ignorecase: false`" (<https://github.com/kaelzhang/node-ignore/blob/master/README.md>,
"`ignorecase` defaults to `true`").

## 3. How the Rust `ignore` crate does it, and who publishes it as napi

The crate is the canonical implementation: "a fast recursive directory iterator that respects
various filters such as globs, file types and `.gitignore` files", used by ripgrep and by `fd`
(<https://docs.rs/ignore/latest/ignore/>, module docs; current version 0.4.33, published
2026-08-04). Its `gitignore` module "implements the specification as described in the
gitignore man page from scratch. That is, this module does not shell out to the git command
line tool" (<https://docs.rs/ignore/latest/ignore/gitignore/index.html>).

`WalkBuilder` is where the semantics live, and its documented rules are worth reading in full
(<https://docs.rs/ignore/latest/ignore/struct.WalkBuilder.html>). Two things there matter more
than the rest:

- **Default precedence is `.ignore` > `.gitignore` > `.git/info/exclude` > global gitignore >
  explicitly added files, and "any `.ignore` file overrides all `.gitignore` files"** — a
  precedence that is _not_ hierarchy-sensitive. `hidden(true)`, `parents(true)`, `ignore(true)`,
  `git_ignore(true)`, `git_global(true)` and `git_exclude(true)` are all on by default;
  `require_git` gates the git-related ones on actually being in a repository.
- The crate exposes `build_ignore_matchers` / `IncrementalIgnore` for matching a path without
  walking, which is the hook a lazy tree would want.

**There is no published napi binding of the `ignore` crate.** I checked the registry for
`@napi-rs/ignore`, `napi-ignore`, `ignore-rs`, `rust-ignore`, `gitignore-rs`, `ignore-napi`,
`@napi-rs/walkdir`, `@napi-rs/globset`, `napi-globset` and `globset`; all return HTTP 404 from
`registry.npmjs.org`. Registry search for "ignore gitignore rust napi" returns only
`kaelzhang/node-ignore` (pure JS), `@balena/dockerignore`, `ignore-walk` (pure JS, minimatch),
`@napi-rs/cross-toolchain` and unrelated napi-rs packages. So "use the `ignore` crate" means
either compiling a binding ourselves or shipping the crate's most famous consumer as a binary.

### `fd` and `ripgrep` as sidecars

Both are the `ignore` crate with a CLI. Kira already has a mechanism for obtaining them:
`@earendil-works/pi-coding-agent` resolves `fd` and `rg` through
`dist/utils/tools-manager.js` — first a system binary on `PATH` (`fd`, `fdfind`, `rg`), then a
GitHub release tarball downloaded into `getBinDir()`, which is `<agentDir>/bin`
(`dist/config.js`, `getBinDir`; `getAgentDir` resolves to `~/.kira/agent` after this repo's
`scripts/patch-pi-config-dir.mjs`). `ensureTool` and `getToolPath` are **not** in pi's public
exports — `dist/index.d.ts` exports `getAgentDir` but not `getBinDir`, `getToolPath` or
`ensureTool` — so reusing it means a deep import into `dist/`, which is not a contract.

Measured, same three checkouts:

| command                               | kira (414 files) | clasher (243) | plane (5,248)  |
| ------------------------------------- | ------------------- | ------------- | -------------- |
| `fd --type f`                         | 26 ms / 268         | 23 ms / 239   | 29 ms / 5,177  |
| `fd --type f --hidden --exclude .git` | 22 ms / 518         | 14 ms / 308   | 16 ms / 5,386  |
| `fd --type f --hidden --no-ignore`    | 60 ms / 61,776      | 16 ms / 4,618 | 74 ms / 93,006 |
| `rg --files`                          | 18 ms / 268         | 8 ms / 239    | 12 ms / 5,177  |

Fast. But **fd's answer is not git's answer.** Search tools and git apply different
ignore semantics, so a tree built with `fd` can disagree with `git status`. That divergence is
a _feature_ of a search tool and a _bug_ for a git workbench. It also cannot be switched off —
`.ignore` support is `WalkBuilder::ignore(true)`, on by default, and turning it off costs the
search-tool behaviour pi's own `find` tool depends on.

## 4. Asking git

`git ls-files --exclude-standard` is documented as: "Add the standard Git exclusions:
`.git/info/exclude`, `.gitignore` in each directory, and the user's global exclusion file."
That single flag is the whole matching requirement, including the parts a hand-rolled
matcher usually misses.

The four invocations the tree needs, from <https://git-scm.com/docs/git-ls-files>:

| purpose                | command                                             | documented meaning                                                                                                                                                                                                      |
| ---------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| visible files          | `git ls-files -co --exclude-standard`               | `-c` tracked + `-o` untracked, minus standard exclusions                                                                                                                                                                |
| ignored entries, roots | `git ls-files -o -i --exclude-standard --directory` | `-i` "show only ignored files… must be used with either an explicit `-c` or `-o`"; `--directory` "if a whole directory is classified as 'other', show just its name (with a trailing slash) and not its whole contents" |
| ignored files, full    | `git ls-files -o -i --exclude-standard`             | same, one line per file                                                                                                                                                                                                 |
| scoped to a subtree    | any of the above plus `-- <pathspec>`               | pathspec limits the listing, so expanding an ignored directory costs only that directory                                                                                                                                |

Measured, same three checkouts:

| command                                         | kira               | clasher       | plane             |
| ----------------------------------------------- | --------------------- | ------------- | ----------------- |
| `ls-files -co --exclude-standard`               | 9 ms / 414            | 7 ms / 243    | 15 ms / 5,248     |
| `ls-files -o -i --exclude-standard`             | 102–129 ms / 63,993   | 9 ms / 4,314  | 239 ms / 92,284   |
| `ls-files -o -i --exclude-standard --directory` | 4 ms / 15             | 3 ms / 12     | 18 ms / 54        |
| `check-ignore --stdin` over every raw-walk path | 327 ms / 64,407 paths | 20 ms / 4,557 | 4,159 ms / 97,532 |

Two things fall out.

**The partition is exact.** On kira the visible set (414) and the ignored set (63,993) are
disjoint and their union is 64,407 — the exact number of files a raw `readdir` walk finds
outside `.git`. The tree and the reveal control are therefore two views of one answer, not
two independent enumerations. `git ls-files -co` also returns tracked files _inside_ ignored
directories, which is the correct treatment of `git add -f` and which an ignored-set-only
design would get wrong.

**`check-ignore --stdin` is the wrong tool.** Batching paths to it costs 327 ms–4.2 s, an
order of magnitude worse than `ls-files`, and git's own docs warn its string-level behaviour
diverges from traversal for directory patterns (node-ignore's README documents the same
discrepancy at <https://github.com/kaelzhang/node-ignore/blob/master/README.md>,
"`checkIgnore()` and a directory passed with a trailing slash"). Use `ls-files`.

### Does respecting gitignore save the walk, and do we walk twice?

**Yes it saves the walk, and no we do not walk twice — but only if the prune happens during
descent, and git is what makes that possible without a matcher.**

- With a hand-rolled walk, filtering after the fact is worthless: 358 ms for the same 979
  entries that cost 7 ms when pruned during descent. Pruning during descent requires the
  matcher to be consulted per directory, which requires the cascade to be built as you go.
- With git as the oracle there is no walk to save: `ls-files` returns the pruned set directly
  and its cost is independent of how large the ignored subtrees are (9 ms on kira whether
  `node_modules` holds 61,776 files or none). This is the strongest argument for git over any
  matcher: the expensive part is not matching, it is `readdir`.
- The reveal control does **not** force a full second walk. `-o -i --directory` names the
  ignored roots in 4 ms; expanding one costs only its own subtree (107 ms for all 63,180 files
  under `node_modules/`, and less if the user never expands it). The naive alternative — walk
  everything once, keep the ignored entries aside — is what row 4 of the raw-Node table
  costs (358 ms and 18 MB of heap) and it _still_ gets the semantics wrong, because a pruned
  directory's contents were never read.

The one thing git cannot give: an untracked, non-ignored, **empty** directory is not in
`ls-files -co` at all. Deriving directories from the file list means empty directories are
missing from the tree. That is a cosmetic gap, and `--directory` on the `-o` side is where the
information would come from if it ever matters.

## 5. The pure-JS cost, and where a naive matcher breaks

`ignore@7.0.9` (published 2026-09-08, zero dependencies, the matcher ESLint uses) is the only
serious candidate: <https://github.com/kaelzhang/node-ignore>. `ignore-walk@9.0.0` exists but
"is parsed by npm using `minimatch`… and it does not work in the .gitignore way" per
node-ignore's own README, which is a warning about `.npmignore`, not gitignore.
`@secretlint/walker@13.0.5` is the closest complete design — it says it is "Modeled after
ripgrep's `ignore` crate", carries an `IgnoreChain` of per-directory matchers, and walks with
`readdir` + prune — and it depends on exactly `ignore@^7.0.6` + `picomatch@^4.0.5`
(<https://www.npmjs.com/package/@secretlint/walker>;
`https://cdn.jsdelivr.net/npm/@secretlint/walker@13.0.5/src/ignore-stack.ts`,
`IgnoreChain`/`isIgnoredByChain`). It is a good reference implementation, not a dependency to
adopt: its walker takes a list of ignore _file names_ and reads nothing else, so
`.git/info/exclude` and `core.excludesFile` are out of scope by construction.

I ran 24 spec cases through `ignore@7.0.5` (the copy in this repo's bun store). 23 passed. The
one "failure" is the interesting one:

| pattern class                         | result                                                           |
| ------------------------------------- | ---------------------------------------------------------------- |
| `doc/frotz/` vs `a/doc/frotz/`        | correct (middle slash anchors)                                   |
| `foo/` vs `foo` (file)                | correct (directory-only)                                         |
| `**/foo`, `a/**/b`, `abc/**`          | correct (all three `**` shapes)                                  |
| `*.log` then `!keep.log`              | correct (last match wins)                                        |
| `/abc/` then `!/abc/a.js`             | correct — `abc/a.js` stays ignored                               |
| `\#foo`, `\!imp.txt`, trailing spaces | correct                                                          |
| `a?c` vs `a/c`; `[a-c].txt`           | correct                                                          |
| `foo/*` vs `foo/bar/hello.c`          | returns ignored; the man page says the pattern does not match it |

That last row is not a bug in either direction. gitignore(5) states `foo/*` "does not match
`foo/bar/hello.c`" _as a pattern match_, while the traversal rule ("it is not possible to
re-include a file if a parent directory of that file is excluded") means git does not list
the file. node-ignore implements the traversal semantics and says so in its README
("`ignore` models the traversal semantics"). It is exactly the kind of divergence that makes
hand-rolled matching dangerous: the matcher is right, the pattern is right, and the answer
still depends on whether you asked about the path or the walk.

Where a hand-rolled or naive version actually breaks, in order of how likely we are to hit it:

1. **`.git/info/exclude` and `core.excludesFile` are simply not read** by node-ignore,
   `ignore-walk`, or `@secretlint/walker`. `gitignore-fs@2.2.3` claims to cover them and
   shells out to `git config --get core.excludesFile` to find the global file
   (`src/index.ts`, `spawn`/`spawnSync` of `git config`) — it delegates the part it cannot
   compute, which is a fair summary of the whole problem.
2. **Case sensitivity inverted by default** (`ignorecase: true`). On Linux this silently
   ignores files git would show.
3. **The parent-directory rule**, if you test paths instead of pruning during descent.
4. **Nested-file precedence** — you must build a chain and test relative to each level's own
   root, or `packages/foo/.gitignore`'s `dist/` will be applied at the wrong anchor.
5. **`***` and other runs of asterisks.** node-ignore's README documents that the git _binary_
   treats `***/foo` and `a**/b` as globstars while the man page does not, and node-ignore
   follows the man page.
6. **Trailing-slash anchoring for the root.** A `dist/` in the root `.gitignore` and a `dist/`
   in `apps/web/.gitignore` are different rules with the same text.

Cost of the cascade, measured with `ignore@7.0.5` applied per entry and pruning during
descent (one `readFile` per directory for `.gitignore`, matcher call per entry):

| checkout | raw `readdir` recursive | name-only prune | node-ignore cascade                  |
| -------- | ----------------------- | --------------- | ------------------------------------ |
| clasher  | 28 ms / 5,160           | 22 ms / 5,061   | 25 ms / 383 kept, 777 matcher calls  |
| plane    | 560 ms / 111,121, +17MB | 46 ms / 6,660   | 281 ms / 6,554, 16,290 matcher calls |
| kira  | 289 ms / 72,430         | 9 ms / 959      | 59 ms / 1,138, 2,286 matcher calls   |

The matcher is not the bottleneck; the extra `readFile` per directory and the extra syscalls
are. A name-only prune list gets clasher wrong by a factor of thirteen (5,061 entries kept
where gitignore leaves 383) because `.venv/` holds most of that checkout — the exact case
gitignore exists for. Note also the middle column of the clasher row: name pruning is not a
cheap approximation of gitignore, it is a different answer.

## 6. Packaging

### What is already in the tree

The premise "the main process has zero native dependencies" is true of anything we compile:
SQLite is Node's built-in `node:sqlite` (`apps/desktop/src/main/db/threads.ts` imports
`DatabaseSync`). But the production dependency tree already contains a prebuilt `.node`:
`@earendil-works/pi-tui@0.85.1` (reached through `@earendil-works/pi-coding-agent`, which
`apps/desktop/src/main/pi/*.ts` imports) ships
`native/darwin/prebuilds/darwin-{x64,arm64}/darwin-modifiers.node` and
`native/win32/prebuilds/win32-{x64,arm64}/win32-console-mode.node`, loaded with a bare
`require` after trying several candidate paths
(`dist/native-modifiers.js`, `loadNativeModifiersHelper`; `dist/native-module-path.js`,
`getNativeModuleCandidates`, which pushes `resolve(pkg)/../<nativePath>`, `moduleDir/../`,
`moduleDir/` and `dirname(process.execPath)/` as candidates). There is no Linux prebuild, so
nothing is `dlopen`ed on Linux.

Two things follow. First, "adding a native dependency" is not a new class of problem for this
pipeline — it is already solved for one package, by a pattern we would copy. Second, that
pattern is not free: pi-tui keeps four candidate paths precisely because the correct location
differs between a plain install, an asar, and an unpacked asar.

### N-API versus node-gyp

Electron's own page states the constraint: Electron "has a different application binary
interface (ABI) from a given Node.js binary", so native modules "will need to be recompiled
for Electron", otherwise you get `NODE_MODULE_VERSION $XYZ … requires NODE_MODULE_VERSION
$ABC` (<https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules>).
Electron 44.4.1 reports `modules: 149` and bundles Node 24.21.0
(<https://releases.electronjs.org/releases.json>). The page's remedies are `@electron/rebuild`,
`npm_config_runtime=electron`, or `node-gyp rebuild --target=<electron> --dist-url=https://electronjs.org/headers`.
**A Node-API (`N-API`) addon is exempt from that**: N-API is ABI-stable across Node and
Electron versions, so a package that declares `binary: { napi_versions: [...] }` and ships
prebuilds needs no rebuild.

`@parcel/watcher@2.6.0` (published 2026-07-20, MIT, `parcel-bundler/watcher`) is the watcher
option. Its README calls it "A native C++ Node module" — **not** Rust and not napi-rs, which
is worth stating plainly since it is often described as the napi watcher. It declares
`"binary": {"napi_versions": [3]}` and builds prebuilds with
`prebuildify --napi --strip --tag-libc`, so it is N-API 3 and ABI-stable. Coverage is a
platform package per target: `darwin-x64`, `darwin-arm64`, `win32-x64`, `win32-arm64`,
`linux-{x64,arm64,arm}-{glibc,musl}`, `freebsd-x64`, `android-arm64`, all listed as
`optionalDependencies` of the main package (registry metadata for `@parcel/watcher@2.6.0`).

The packaging trap is visible in its `index.js`: the binding is loaded with a _computed_
`require` —

```js
let name = `@parcel/watcher-${process.platform}-${process.arch}`;
if (process.platform === 'linux') {
  /* append -musl or -glibc via detect-libc */
}
try {
  binding = require(name);
} catch (err) {
  /* then ./build/Release, then ./build/Debug */
}
```

— and failure produces the message that names the real constraint: "No prebuild or local
build of @parcel/watcher found. Tried `@parcel/watcher-linux-arm64-glibc`. Please ensure it is
installed (don't use `--no-optional` when installing with npm)." Its `install` script
(`scripts/build-from-source.js`) is a no-op unless `npm_config_build_from_source=true`, which
is the right shape but also means a missing platform package is a runtime failure, not an
install failure.

### What electron-builder needs

- **`.node` files must leave the asar.** Electron's docs list `process.dlopen` — "Used by
  `require` on native modules" — among the APIs that force unpacking, and note that "only
  `execFile` is supported to execute binaries inside ASAR archive" (`exec` and `spawn` are
  not) (<https://www.electronjs.org/docs/latest/tutorial/asar-archives>).
- **electron-builder does this automatically.** Its docs: "Node modules, that must be
  unpacked, will be detected automatically, you don't need to explicitly set `asarUnpack`",
  and `smartUnpack` defaults to `true` (<https://www.electron.build/v26/docs/configuration>,
  `asar?` and `asarUnpack?`; <https://www.electron.build/v26/docs/contents/>). This app is on
  `electron-builder@^26.15.3`, and the v26 docs are the ones cited.
- **`npmRebuild` defaults to `true`**, which is the part that would break a bun pipeline:
  "Whether to rebuild native dependencies before starting to package the app." It runs
  `@electron/rebuild`, and `@electron/rebuild` source-builds packages it cannot match to a
  prebuild layout. There is a known issue class here — `@parcel/watcher` "doesn't use napi-rs,
  it actually uses `prebuildify`" and has been source-rebuilt needlessly on Windows runners
  with no C++ toolchain (<https://github.com/electron/rebuild/issues/1163>, and a real fix in
  the wild at
  <https://github.com/gridaco/grida/commit/133a293b7c3211e0037ae4e043f6e5b9e9ca8d33>:
  "never source-rebuild `@parcel/watcher`; use its N-API prebuild on every platform"). The
  fix is `nativeModules.electronRebuildConfig.ignoreModules` or
  `buildDependenciesFromSource: false`; both are electron-builder config
  (<https://www.electron.build/v26/docs/configuration>, `buildDependenciesFromSource`,
  `nodeGypRebuild`, `npmRebuild`).
- **A sidecar binary is not a `.node`.** It is not a Node module at all, so `smartUnpack`
  does not recognise it; it goes in `extraResources` and is read from
  `process.resourcesPath`, which is exactly what the docs recommend: "Use `extraResources`
  for native binaries, CLI tools, or data files that need to be accessible at runtime."
- **The app's own `files` list is narrow.** `apps/desktop/electron-builder.yml` sets
  `files: [out/**, package.json]`. That is fine for bundled code — electron-builder always
  adds production `node_modules` regardless of patterns ("`package.json` and
  `node_modules/**/*` (production only) are always included regardless of patterns") — but it
  means anything new has to arrive through `node_modules` or `extraResources`, not through a
  custom directory.

### What would break in `bun install && electron-builder`

Stated plainly, for each option:

- **napi package with prebuilds (e.g. `@parcel/watcher`).** Three distinct failure points.
  (1) `bun install` does not run lifecycle scripts for untrusted packages — this repo's
  `package.json` has `"trustedDependencies": ["electron"]` and nothing else — so the package's
  `install` script never runs; that is _harmless_ here because the prebuild comes from the
  optional dependency, but it means a missing platform package fails at first `require`, not
  at install. (2) `bun`'s optional-dependency handling and the `--no-optional` / `omit=optional`
  case both silently drop the platform package, which is the failure the package's own error
  message anticipates. (3) electron-builder's `npmRebuild: true` may try to source-build a
  package that only ships prebuilds, and on a Windows runner without Visual Studio C++ tools
  that is fatal. `externalizeDepsPlugin()` in `apps/desktop/electron.vite.config.ts`
  externalises everything in `dependencies`, so the computed `require` survives bundling — but
  only because the package is in `dependencies`; in `devDependencies` it would be bundled and
  the dynamic require would fail to resolve.
- **Sidecar binary (ripgrep/fd).** Nothing breaks in the install. What breaks is silent: a
  binary in `extraResources` is not code-signed with the app, and on macOS a separately-signed
  or unsigned helper inside a hardened-runtime bundle is a notarization problem, not a build
  problem. It also has to be present for every target arch in the build (`mac.target: [dmg]`,
  `win.target: [nsis]`, `linux.target: [AppImage]` today — a single-arch build needs one
  binary, a universal macOS build needs two). The `@vscode/ripgrep` precedent shows the modern
  shape: `@vscode/ripgrep@1.18.0` has **no install script at all** and ships its binaries as
  optionalDependencies (`@vscode/ripgrep-linux-x64`, `-darwin-arm64`, `-win32-x64`, twelve in
  total, per the registry metadata) — VS Code moved from download-on-postinstall to inline
  binaries, and strips the non-target ones at packaging time
  (<https://github.com/microsoft/vscode/commit/c4471e24faf21ae50af048d09d68cb6e3092e4ad>).
- **`git ls-files`.** Nothing to package. The risk is the opposite kind: no build failure, a
  runtime one, and it is discussed in the next section.
- **Pure JS (`ignore@7` + our cascade).** Nothing to package, nothing to rebuild, nothing to
  unpack. This is the option with zero packaging risk, and it is why it survives as the
  fallback rather than being dismissed.

## 7. What we are rendering into

I read the installed package rather than fetching it: `@astryxdesign/core@0.6.2` is present in
this repo at `apps/desktop/node_modules/@astryxdesign/core`, a symlink into the bun store at
`node_modules/.bun/@astryxdesign+core@0.6.2+52b2d50a3cc08aa1/node_modules/@astryxdesign/core`.
No `bun install` was run. The `astryx_get`/`astryx_search` MCP tools were also used and agree
with the source.

**`TreeList` does not virtualize.** `renderItems` maps over `items` and recurses into
`item.children` when the item is expanded, returning a `<TreeListItem>` per visible node, and
the root `<ul role="tree">` renders `renderItems(items, 0, [])` directly — every visible node
becomes DOM
(`src/TreeList/TreeList.tsx`, `renderItems` at line 285, `return items.map(...)` at 300,
`{renderItems(items, 0, [])}` at 375). There is no windowing, no `IntersectionObserver`, no
`react-window`, no `@tanstack/react-virtual`: the package's only runtime dependency is
`intl-messageformat`, with `@stylexjs/stylex`, `react` and `react-dom` as peers (installed
`package.json`). Its own contract states the same thing as an invariant — FR1: "The current
render contains one Tree list, one Item and Item label per rendered node"
(`src/TreeList/TreeList.spec.md`), and under "Performance and resources": "No new performance
or resource rule is introduced."

Roughly how much DOM one row costs, counted from the source
(`src/TreeList/TreeListItem.tsx`, `return (` at 550):

- Always: `<li role="treeitem">` (552), `<div rowWrapper>` (576), the `<div>` carrying
  `styles.contentWrapper` (577), and a `<span content>` wrapping `<span label>` (542 and 417).
  **Five elements.**
- With the default `variant="lineGuides"`: plus `<div treeBranches>` (568) and, from
  `TreeListBranches`, two `<div>`s per rendered connector line — one per non-last ancestor
  level plus the current level (`src/TreeList/TreeListBranches.tsx`, `ancestorsIsLast.map` at
  99). At depth 0 that is **eight elements**.
- Plus one `<button>` and one `<Icon>` span for any item with children (470, 434), plus a
  `<span>` each for `startContent` and `endContent` when used, plus one for `description`.

So **6–10 DOM elements per visible row**, call it 30,000–50,000 elements for a 5,000-row tree.
I did not render it: `dist/` ships uncompiled `stylex.props(...)` calls, so `TreeList` needs
the StyleX build plugin and cannot be `renderToStaticMarkup`ed as-is. **The element count is
counted from source, not measured** — treat the range as an estimate and confirm it in the dev
app before relying on it.

`@astryxdesign/core` ships **no virtualizer at all** — 111 source directories, and the only
component whose source mentions "virtualized" is `Outline`, a table-of-contents, and only to
say it tolerates virtualized content ("With no target in the DOM — lazily-rendered or
virtualized content —", `src/Outline/Outline.tsx:410`). Its `Table` documents a
`transformScrollWrapper` hook "to attach a `ref` to the scrollable element (e.g. for
scroll-aware sticky-column shadows or virtualization)" (`src/Table/types.ts`,
`ScrollWrapperRenderProps`) — i.e. a seam for the consumer to add virtualization, not a
built-in. Adding `@tanstack/react-virtual` to a flattened row list is the standard answer, and
it is a second dependency we would own.

What that means for the tree design: **render only what the user has expanded.** The
`items` prop is a recursive structure and expansion state is internal, seeded by `isExpanded`
on the data. A level-by-level tree where a collapsed folder's children are simply absent from
`items` renders exactly as many rows as are on screen, needs no virtualizer, and is also what
makes the walk lazy. `TreeList`'s "nest more than 4–5 levels deep" guidance and the fact that
`isExpanded` only sets _initial_ state (`src/TreeList/TreeListTypes.ts`, `isExpanded` doc:
"Whether the item is initially expanded") both point the same way.

## 8. Watching, if we refresh live

Node's own watcher is enough. `fs.watch` gained recursive support on Linux, AIX and IBMi in
v19.1.0, and Electron 44.4.1 bundles Node 24.21.0; `fsPromises.watch` exists with an
`AbortSignal`, a `maxQueue` (default 2048) and an `overflow` policy of `'ignore'` or
`'throw'` (<https://github.com/nodejs/node/blob/v24.x/doc/api/fs.md>, `fs.watch` and
`fsPromises.watch`). Measured: `watch(dir, { recursive: true })` on a 200-file directory
attaches in 6.4 ms.

The documented caveats are real and worth designing around
(<https://github.com/nodejs/node/blob/v24.x/doc/api/fs.md>, "Caveats"):

- "On Windows, no events will be emitted if the watched directory is moved or renamed. An
  `EPERM` error is reported when the watched directory is deleted."
- On Linux and macOS the watch follows the **inode**: "If the watched path is deleted and
  recreated, it is assigned a new inode… Events for the new inode will not be emitted." A
  folder replaced by a fresh checkout stops reporting.
- `filename` in the callback "is not always guaranteed to be provided… have some fallback
  logic if it is `null`" — so a debounced "something under this folder changed, re-list the
  expanded directories" is more robust than applying a diff from the event.
- "watching files or directories can be unreliable, and in some cases impossible, on network
  file systems (NFS, SMB, etc)".

Node 24.16.0 also added an `ignore` option to `fs.watch` taking globs (via `minimatch`),
RegExps or a predicate — useful for dropping `.git/` churn, but it is glob syntax, not
gitignore, so it cannot be the ignore mechanism.

`chokidar@5.0.0` (published 2026-05-21, ESM-only, one dependency, Node ≥20.19) is the pure-JS
alternative and would be the right pick if `fs.watch`'s raw events proved unusable. Its README
lists exactly the problems we would otherwise hand-roll: "macOS events report filenames",
"events are not reported twice", "changes are reported as add / change / unlink instead of
useless `rename`", `atomic` writes, `awaitWriteFinish`, and "recursive watching is always
supported, instead of partial when using raw events"
(<https://github.com/paulmillr/chokidar>). It still uses `fs.watch` underneath, so it inherits
the inode caveat; it removes the event-shape work, not the platform limits.

For a folder the agent is editing, a debounce plus a re-list of expanded directories is
cheaper than an event diff: re-listing one directory with `git ls-files` scoped by pathspec is
a few milliseconds, and it reuses the same code path as the initial load.

## 9. What this means for Kira

**Build the tree from git, render it lazily, watch it with `fs.watch`.**

1. **Initial load.** `git ls-files -co --exclude-standard -z` in the folder, with
   `-- <pathspec>` to scope to the folder if the project is a subdirectory of the repo.
   Derive directories from the file paths (every ancestor of a listed file is a non-ignored
   directory). Store the result as a flat sorted path list; the `TreeList` `items` structure is
   built per expanded level from that list. Measured cost: 3–15 ms.
2. **Reveal ignored.** `git ls-files -o -i --exclude-standard --directory -z` for the collapsed
   ignored roots (4 ms), then `git ls-files -o -i --exclude-standard -z -- <dir>` scoped to a
   directory the user expands (107 ms for all of `node_modules`, paid once, only on expand).
3. **Render.** Level by level: only expanded folders contribute children, so `TreeList` renders
   the rows on screen and the missing virtualizer does not matter. If a "expand all" affordance
   is ever wanted, that is the point to add `@tanstack/react-virtual` — not before.
4. **Watch.** `fs.watch(folder, { recursive: true })`, debounced ~150 ms, invalidating and
   re-listing only the expanded directories. Treat a `null` filename and an `EPERM`/inode
   change as "re-list everything".
5. **Fallback.** When `git` cannot be spawned (ENOENT) or `git rev-parse --is-inside-work-tree`
   fails, fall back to a `node-ignore@7` cascade: an `IgnoreChain` of per-directory matchers,
   `ignorecase: false`, prune during descent, plus a read of `.git/info/exclude` and
   `git config --get core.excludesFile` when git is available but the folder is not a checkout.
   That is the ~200 lines of code this recommendation avoids owning in the happy path, and it
   is worth writing only because of step 5 — not because it is faster.

**Cost, concretely.** The git path is roughly 100–150 lines we own: spawn with `-z` and parse
NUL-separated output, two path lists, one cache invalidated by the watcher, one IPC channel
with the existing `ipc/` envelope shape. Zero new dependencies, zero native code, zero
packaging changes. It is correct by construction for nested `.gitignore`, negation,
directory-only patterns, `info/exclude` and `core.excludesFile`, because it is git.

At realistic sizes the ranking does not change. For a 5k-file checkout `git ls-files` is ~10 ms
and a pruned Node walk is ~10–50 ms — both fine. For a 50k-file checkout the Node walk grows
with the tree (560 ms and +17 MB on plane's 111k entries) while `git ls-files` stays at 15 ms.
For a `node_modules`-bearing monorepo the gap is the whole point: 9 ms versus 289–423 ms plus
10–18 MB of heap, and the reveal control adds 4 ms rather than a second walk.

The ranking, all four axes:

| option                       | speed (measured)                    | packaging risk              | maintenance risk             | lines we own   |
| ---------------------------- | ----------------------------------- | --------------------------- | ---------------------------- | -------------- |
| `git ls-files`               | 3–15 ms visible, 4 ms ignored roots | none                        | git absent                   | ~100–150       |
| `node-ignore` cascade        | 25–281 ms on 0.4k–6.6k kept files   | none                        | matcher drift                | ~200           |
| `fd`/`rg` sidecar            | 16–74 ms per query                  | binary per arch, signing    | pi's tool manager is private | ~80 + fallback |
| napi binding of `ignore`     | — (does not exist)                  | —                           | —                            | —              |
| `@parcel/watcher` (watching) | n/a                                 | optional-dep + rebuild trap | low (2.6.0, 2026-07)         | ~10            |

### Left unverified

- **The `TreeList` DOM element count is counted, not measured.** I derived 5–10 elements per
  row from the source because `dist/` ships uncompiled `stylex.props` calls and cannot be
  server-rendered without the StyleX plugin. Confirm in the dev app with a 5,000-row tree
  before treating "no virtualizer needed" as settled.
- **No measured row-count limit for `TreeList`.** There is no perf test, no scale note in the
  changelog, and the spec says only "No new performance or resource rule is introduced". The
  5,000-row number above is my estimate from the element count, not a measured ceiling.
- **Whether `git` is present on the machines we ship to.** I confirmed the mechanism
  (macOS's `/usr/bin/git` shim can raise the CLT installer prompt; GitHub Desktop bundles its
  own git via `dugite` precisely to avoid this) but did not measure a Kira install on
  Windows or on a Mac without Command Line Tools. The fallback in step 5 is a design
  consequence of not knowing, and step 5 is the part to test first.
- **`git ls-files` inside a subdirectory project.** Scoping with `-- <pathspec>` works, but I
  measured only repo-root queries. A project whose folder is a subdirectory of a larger repo
  needs the pathspec path re-measured, and `git ls-files` resolves paths relative to the repo
  root, so the tree builder has to re-root them.
- **Worktrees and submodules.** `git ls-files --recurse-submodules` "currently there is only
  support for the `--cached` and `--stage` modes" (<https://git-scm.com/docs/git-ls-files>), so
  submodule contents will not appear. Unverified: whether that matters for a chat's working
  folder in practice.
- **The exact set of deviations between the `ignore` crate and the git binary.** I demonstrated
  one, decisively, and found the documented precedence rule that causes it. I did not enumerate
  the rest, and the crate's own docs do not publish a deviation list.
- **`@parcel/watcher`'s behaviour under bun's optional-dependency layout.** The trap is
  documented in the package's own error message and in `electron/rebuild#1163`, but I did not
  install it and build. Its `napi_versions: [3]` declaration is what makes it ABI-safe; that
  much is from the registry metadata, not from running it.
- **Whether electron-builder's `smartUnpack` actually unpacks pi-tui's prebuilds in this app's
  current `files: [out/**, package.json]` configuration.** The mechanism is documented and the
  `.node` files are in the production tree, but the only proof is a packaged macOS or Windows
  build that loads the TUI native helper — which is a pre-existing risk, not one this change
  introduces.
