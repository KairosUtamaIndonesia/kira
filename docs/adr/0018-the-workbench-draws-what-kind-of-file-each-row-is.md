# The workbench draws what kind of file each row is

Date: 2026-09-22

## Context

Every row in the workspace tree drew one of two glyphs: a folder, or a file. A test, a config, a
stylesheet and a screenshot all read alike, so finding a file by eye meant reading names rather than
recognising shapes — the thing a file tree is for.

The workbench's spec said everything that looks like anything is Astryx's, and Astryx's own icon
registry cannot answer here: its thirty names are chrome — `close`, `chevronDown`, `viewColumns` —
with no file types among them. So the vocabulary had to come from somewhere, and the choice was
between keeping our own map of extensions to a handful of glyphs and taking one that already exists.

## Decision

**The tree draws `material-icon-theme`'s icons — the VS Code Material Icon Theme — bundled whole.**
Its manifest answers "what kind of file is this" for 2,135 file names and 1,377 extensions, and its
1,251 SVGs are drawn for exactly this: a 16px file tree. A subset of it would be a guess about which
types matter, and the guess would be wrong in the repository nobody tested.

**It is bundled rather than fetched, and as a devDependency rather than a runtime one.** The SVGs are
emitted into `out/renderer/assets/` as files and the manifest is bundled into the renderer's chunk as
data, and `electron-builder.yml` already ships `out/**` and nothing else, so both travel with the app
and no network is involved. None
of the package's own JavaScript runs: its single dependency, `chroma-js`, belongs to the generator API
that produces a theme rather than to reading one. Measured, the whole thing is 450 KB of manifest plus
1,248 asset files averaging 800 bytes — a rounding error against Electron's own ~200 MB, and it takes
the renderer's main chunk from 2.5 MB to 3.0 MB.

**The SVGs are imported as files, not inlined.** They average under a kilobyte, and Vite inlines
assets under 4 KB as base64 by default, so an unqualified import would have pasted a megabyte of
base64 into the bundle where the window carries every icon it never draws. As files, the window
fetches the handful of icons that are on screen.

**The lookup is ours and is about thirty lines.** A file's name first, then the longest extension the
theme knows — which is what makes its own multi-part entries, `test.ts` and `d.ts`, reachable at all
— then a folder's name, each falling back to the theme's plain file or folder icon. The theme's light
tables are sparse overrides, so a miss in them falls back to the theme's normal answer and never to
its plain icon.

**The chrome stays Astryx's and lucide's.** This is a vocabulary for file types and nothing else: the
close cross, the chevrons and the board's bands are drawn as they were.

## Consequences

**The exception to "everything that looks like anything is Astryx's" is a vocabulary rather than a
style.** Sizes, colours and shapes are the theme's own, and the row icon is drawn at 1rem, the size
the tree's glyphs were. Nothing else in the pane changed, and a row is still named by its label: the
image is drawn with an empty `alt`, so the icon adds nothing for anyone reading by ear.

**Which set is drawn follows the system's colour scheme.** Foundry's theme hands `color-scheme` to
the system, so the renderer asks the same question the CSS does — `prefers-color-scheme` — and there
is no theme state of its own to read. The theme's light overrides matter for a handful of real files:
`bun.lock` and `*.toml` draw differently, most things do not.

**The theme's expanded-folder icons go unused.** It has an open-folder icon for every closed one, and
`TreeList` does not say what is expanded, so a row draws the closed folder whatever state it is in.
The same limit already decides that a level is re-read even when the reader has collapsed it.

**The icons are reached by a path into the app's own `node_modules`.** The glob names
`apps/desktop/node_modules/material-icon-theme/icons`, which is where a direct devDependency lands. If
the package ever stopped being one, the glob would match nothing and every row would draw its label
with no icon rather than failing — the manifest import is the half of this that cannot go quiet,
because it would fail the build.

**The manifest is the weight in this decision, not the icons.** It is one import of 450 KB in the
renderer, and trimming it to the tables a lookup reads is the obvious move if that ever matters more
than the simplicity of taking the theme as it ships.

## Revisit if

The bundle weight starts to matter, at which point the manifest is trimmed to the tables we read
rather than the theme being sampled; or Astryx grows a file vocabulary of its own, at which point
this exception has no reason to exist.
