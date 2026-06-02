# Kira UI Style Guide

This is the **UI/visual design** guide for Kira: color tokens, typography, component selection, and UX rules. It is not an architecture document. Token values live in `src/main.css`; this file documents the roles and rules for using them.

## Overview

Kira is a Tauri desktop app for focused AI-assisted development workflows. The visual identity is **monochrome, quiet, and low-chrome**: neutral grays carry the shell, while color is reserved for meaningful state such as focus, destructive actions, status, and git decorations. Kira should frame the user's work instead of competing with it.

When in doubt:

- Reach for **muted/accent/border** before reaching for color.
- Reach for **CSS variables** before hardcoding hex or OKLCH values.
- Match the nearest **shadcn/ui primitive** before writing custom CSS.
- Keep UI feedback truthful: do not claim a result until real state confirms it.

## Source of truth

| Concern                 | Canonical location                                   |
| ----------------------- | ---------------------------------------------------- |
| Color tokens            | `src/main.css` (`:root`, `.dark`)                    |
| Tailwind theme bindings | `src/main.css`, `@theme inline { … }` block          |
| Component primitives    | `src/components/ui/`                                 |
| Shared frontend helpers | `src/lib/`                                           |
| Path aliases            | `tsconfig.json`, `vite.config.ts`, `components.json` |

Never hardcode a color in component code if a variable already covers it. If a new token is needed, add it to `src/main.css` in both `:root` and `.dark`, expose it in `@theme inline`, then use the token.

## Color roles

Tokens come in pairs: a **surface** and a **foreground** intended to be used together.

| Role                                 | Use it for                                               | Don't use it for                        |
| ------------------------------------ | -------------------------------------------------------- | --------------------------------------- |
| `background` / `foreground`          | App canvas and default text                              | Cards, popovers, sidebars               |
| `card` / `card-foreground`           | Panels lifted off the canvas                             | The canvas itself                       |
| `popover` / `popover-foreground`     | Floating menus, dropdowns, hovercards                    | Inline UI                               |
| `primary` / `primary-foreground`     | The single affirmative action in a flow                  | Decorative accents or secondary actions |
| `secondary` / `secondary-foreground` | Lower-emphasis actions next to a primary                 | The affirmative action                  |
| `muted` / `muted-foreground`         | Captions, placeholders, disabled chrome                  | Body copy or primary actions            |
| `accent` / `accent-foreground`       | Hover/active backgrounds for ghost buttons and list rows | Solid filled buttons                    |
| `destructive`                        | Delete, discard, irreversible actions, errors            | Cancel, close, dismiss                  |
| `border`                             | Hairlines, dividers, input outlines, card edges          | Heavy emphasis                          |
| `input`                              | Form field background only                               | General surfaces                        |
| `ring`                               | Focus-visible outlines and active selection halos        | Persistent decoration                   |
| `sidebar` family                     | Sidebar/navigation surfaces and states                   | General panels                          |
| `editor-surface`                     | Editor, preview, terminal-adjacent panes                 | App chrome                              |

The `sidebar` family expands into `--sidebar`, `--sidebar-foreground`, `--sidebar-primary`, `--sidebar-primary-foreground`, `--sidebar-accent`, `--sidebar-accent-foreground`, `--sidebar-border`, and `--sidebar-ring`. Use these inside sidebar/navigation surfaces so hover, selected, and focus states stay consistent.

### Git decoration colors

Use git decoration tokens only for git status. Do not reuse them for unrelated success/warning/error states.

| Token                        | State          |
| ---------------------------- | -------------- |
| `--git-decoration-added`     | Added / new    |
| `--git-decoration-modified`  | Modified       |
| `--git-decoration-deleted`   | Deleted        |
| `--git-decoration-renamed`   | Renamed        |
| `--git-decoration-untracked` | Untracked      |
| `--git-decoration-copied`    | Copied         |
| `--git-decoration-ignored`   | Ignored by git |

### List rows: hover, selected, current

Use this convention for list-style rows such as command palette items, settings nav, file rows, agent rows, and sidebar entries:

- **Idle:** transparent background.
- **Hover:** `bg-accent`; in a sidebar, `bg-sidebar-accent`.
- **Keyboard-selected:** `data-[selected=true]:bg-accent` plus a visible border/ring when needed.
- **Persistent current row:** `bg-accent` plus `data-current="true"` so styling can distinguish current state from keyboard highlight.
- **Don't:** invent one-off selected colors or hardcode light/dark backgrounds.

### Color mixing

When a tint is needed, use `color-mix` against existing tokens instead of adding a new hardcoded color:

```css
background: color-mix(in srgb, var(--primary) 12%, var(--background));
```

## Typography

- **Family:** Geist is the app sans font. Use the configured `font-sans`; do not switch components to Inter or system sans.
- **Mono:** use `var(--font-mono)` or Tailwind `font-mono` for paths, code, terminal-adjacent UI, and literal values.
- **Sizes:** use Tailwind's default scale unless a component primitive already defines a size.
- **Dense metadata:** use small text (`text-xs` or `text-[11px]`) with `font-semibold`, uppercase, and tracking for section labels when needed.

## Radius

`--radius: 0.625rem` is the base. Derived radii are exposed in `@theme inline`.

- Buttons and inputs: usually `rounded-md`.
- Cards and large panels: usually `rounded-xl`.
- Badges and pills: `rounded-full`.

Match the existing primitive's radius instead of introducing a new one.

## Elevation and shadows

Kira uses shadows sparingly:

1. **Inset hairline:** `border` with the `border` token. This is the default.
2. **Subtle lift:** `shadow-xs` plus a single-token border.
3. **Floating:** reserved for popovers/dialog-adjacent surfaces that escape the main plane.

Do not add more elevation levels unless the token system is intentionally extended.

## Components

Use shadcn/ui primitives in `src/components/ui/` before writing custom controls.

House rules:

- Keep `data-slot` attributes on shadcn-style primitive roots.
- Use `cn()` for class merging.
- Pass caller `className` last so local overrides work.
- Use `class-variance-authority` for components with real variants.
- Do not reimplement headless behavior already provided by a primitive.

### Buttons

Use variants by role:

| Variant       | Use case                                                |
| ------------- | ------------------------------------------------------- |
| `default`     | The single affirmative action in a flow                 |
| `secondary`   | Lower-emphasis sibling next to a default action         |
| `outline`     | Toolbar or standalone actions where filled is too heavy |
| `ghost`       | Icon buttons, list-row triggers, low-chrome actions     |
| `link`        | Inline text actions inside prose                        |
| `destructive` | Delete, discard, irreversible actions; never Cancel     |

Match button size to surrounding density. Do not put a full default-size button into a compact toolbar row.

### Picking the right primitive

| You want…                               | Reach for              | Don't use                 |
| --------------------------------------- | ---------------------- | ------------------------- |
| Hover-only label on an icon-only button | `Tooltip`              | `HoverCard`, `title` attr |
| Rich hover preview                      | `HoverCard`            | `Tooltip`                 |
| Click-revealed action menu              | `DropdownMenu`         | Hand-rolled popover list  |
| Right-click contextual actions          | `ContextMenu`          | `DropdownMenu`            |
| Click-revealed arbitrary content        | `Popover`              | `Dialog`                  |
| Modal decision                          | `Dialog`               | `Popover`                 |
| Edge panel                              | `Sheet`                | Centered `Dialog`         |
| Known single choice                     | `Select`               | Custom listbox            |
| Searchable single choice                | `Command` in `Popover` | `Select`                  |
| Transient confirmation                  | Toast/sonner           | Dialog or inline banner   |
| Persistent inline status                | Inline text + `Badge`  | Toast                     |

If you are styling around a primitive to make it act like a different primitive, stop and choose the correct semantic primitive.

## Tooltips

Tooltips name compact controls. They are not for critical warnings or instructional prose.

- Use a tooltip for icon-only buttons, abbreviated badges, and truncated paths.
- Do not use a tooltip when the control already has a visible label.
- Do not put interactive content inside a tooltip.
- Use `TooltipTrigger asChild` so accessibility props attach to the real trigger.
- Default placement should be top with a small offset unless it clips.

## Icons

Icons come from `lucide-react`. Do not import a second icon library.

- Default size: `size-4`.
- Dense metadata: `size-3` or `size-3.5`.
- Hero/empty states: `size-7` or larger only when intentionally featured.
- Stroke width: lucide default.
- Color: inherit from surrounding text (`text-muted-foreground`, `text-destructive`, etc.).
- Loading icon: `Loader2` with `animate-spin`.

## Form anatomy

Use this structure for label + control + helper text:

- Outer stack: `space-y-2` for compact fields, `space-y-3` for full sections.
- Label group: label plus optional description in `text-xs text-muted-foreground`.
- Control: shadcn primitive (`Input`, `Select`, etc.).
- Errors: surface through `aria-invalid` and primitive styling; do not paint one-off error rings.
- Trailing metadata: `text-xs text-muted-foreground` below the control.

## Scrollbars

If custom scrollbars are needed, define reusable classes in `src/main.css` first. Do not write one-off scrollbar styling per component.

Recommended classes if/when added:

- `.scrollbar-sleek` for sidebars, lists, and popovers.
- `.scrollbar-editor` for editor/terminal-adjacent panes.

## UX rules

### UI copy must not overclaim

Never imply Kira has taken an action, made a decision, or observed a fact unless code has real state or result data to support it. Use neutral process language while work is pending. Reserve words like "verified", "deleted", "found", "protected", or "skipped" for actual results.

### 1. Match in-flight feedback to perceived duration

| Duration           | Feedback                                     |
| ------------------ | -------------------------------------------- |
| 0–100 ms           | None                                         |
| 100 ms–1 s         | Disabled state only                          |
| 1 s–3 s            | Disabled + spinner or label swap             |
| 3 s+ or multi-step | Stage labels, progress, optional reassurance |

Pre-reserve space for labels/icons that may appear during loading. Disable immediately to prevent duplicate submits, but delay visible loading affordances when fast local work would otherwise flicker.

### 2. Match siblings before designing in isolation

If a component has an adjacent sibling in the same flow, they should share icon style, shortcut conventions, density, submit semantics, and copy tone. If the sibling is wrong, fix both rather than spreading debt.

### 3. Do not overload the back-out path

`destructive` is for irreversible or data-losing actions. Cancel, Dismiss, Close, and ordinary back-out actions should stay quiet: usually ghost/secondary, no warning color, no shortcut chip unless the shortcut is central to the UI.

## Cross-platform

Kira runs on Windows, macOS, and Linux.

- Modifier behavior should reflect platform: macOS uses Command, Windows/Linux use Ctrl.
- Shortcut labels must match actual bindings.
- Avoid platform-specific layout assumptions around titlebar/window chrome.
- Loading states and focus management should tolerate remote or high-latency workflows.

## When this guide is silent

1. Look at adjacent code in `src/` for the closest sibling and follow its lead.
2. Check `src/components/ui/` for a primitive that already encodes the pattern.
3. If it is a token question, `src/main.css` is canonical.
4. If none of those resolve it, ask the user before inventing.
