# Theming Astryx for Kira

Kira currently consumes Astryx's `neutralTheme` unmodified through `packages/theme`, with
one manual escape hatch: `packages/theme/src/theme.css` overrides Astryx's font tokens
(`--font-family-body`, `--font-family-heading`, `--font-family-code`) directly in CSS, outside
Astryx's own typography system. This design closes both gaps with a single **derived theme** —
a `defineTheme({ extends: neutralTheme, ... })` call that gives Kira a real brand accent
(`#ff3859`), folds the existing Satoshi/Inter/Geist Mono choice into Astryx's `typography`
config where it belongs, and sets a subtle half-scale `radius` for a restrained,
developer-centric look. It ships as a **built theme** (`astryx theme build`), matching how
`neutralTheme/built` is already consumed today. Component-level overrides and motion tuning
were considered and explicitly deferred — nothing about the current button/badge/etc. styling
or Neutral's interaction timing has a named problem yet.

No visual was generated for this grill.

## Terms

- **derived theme** — a `defineTheme()` call with `extends: neutralTheme` that layers
  Kira-specific tokens, typography, and component overrides on top of Neutral's resolved
  output. Avoid: "custom theme", "override theme".
- **built theme** — the output of `astryx theme build`: a pre-compiled CSS file plus a built
  theme object, used in production instead of runtime style injection. Avoid: "compiled
  theme", "static theme".

## Why

Two loose ends motivated this pass (Q1):

1. `packages/theme/src/index.tsx` wraps children in Astryx's `Theme` using the raw
   `neutralTheme` import — Kira has no accent color of its own. `--color-accent` today is
   just tied to the neutral ramp (`neutral.light[10]` / `neutral.dark[95]`), i.e.
   near-black/near-white, not a brand color.
2. `packages/theme/src/theme.css` hand-overrides Astryx's font CSS variables to load
   Satoshi/Inter/Geist Mono, bypassing Astryx's `typography` config entirely — Astryx's type
   scale (Neutral ships base 14, ratio 1.2 via Figtree) never actually reflects Kira's real
   fonts today.

The chosen scope (Q1, option D) was a full derived-theme pass — accent, typography, and
motion/radius considered together — rather than a narrower fix, on the reasoning that folding
in typography now is less churn than doing it piecemeal later. Component overrides were pulled
into scope initially (Q6) then explicitly walked back (Q8) once no concrete component need
could be named.

## Locked decisions

**Distribution: built theme, not runtime `defineTheme()` (Q2 — durable).**
Astryx supports two modes: runtime `defineTheme()`, which injects a `<style>` tag on mount,
and `astryx theme build`, which pre-compiles CSS plus a built theme object. Kira already
consumes Neutral through its pre-built `/built` + `theme.css` split rather than runtime
injection, and both desktop and admin are shipped apps, not prototypes. Staying consistent
with the existing pattern avoids Astryx's default runtime-injection warning and keeps first
paint fast — the cost is one added build step in `packages/theme`.

- Rejected: **runtime `defineTheme()`** — simplest to iterate on, no new build step, but it
  is Astryx's own guidance for prototypes/theme editors, not shipped apps, and it costs a
  flash-of-wrong-theme risk before hydration that Kira doesn't have today.

This was the interview's only question meeting all three durability gates (hard to reverse,
surprising without context, a real trade-off) — switching distribution modes later means
restructuring how both apps import the theme, not just editing a config value.

## Routine choices

- **Goal / scope (Q1):** a full derived-theme pass — accent, typography, and motion/radius all
  in scope for this round (component overrides were in scope initially, then deferred — see
  Deferred below).
- **Where the theme definition lives (Q3):** `packages/theme/src/kiraTheme.ts`, exported
  alongside the existing `KiraTheme` provider. `packages/theme` is already Kira's single
  home for "how the product looks," and both apps already import from it; a second package
  would split that home for no benefit, and inlining per app would let desktop and admin drift.
- **Accent seed shape (Q4):** one hex seed for both light and dark — Astryx derives the light
  and dark variants via its HCT-based derivation, which keeps contrast (`--color-on-accent`)
  correct automatically. A `[light, dark]` tuple was available but only earns its complexity
  when the two modes need genuinely different brand expressions, which isn't the case here.
- **Accent hex (Q7):** `#ff3859`, given directly by the user. (The interview's own
  recommendation — reusing Neutral's existing internal status-fill-accent blue, `#0074e2` — was
  not taken.)
- **Typography (Q5):** keep the current fonts (Satoshi heading, Inter Variable body, Geist Mono
  Variable code) and Neutral's existing scale (base 14, ratio 1.2) exactly as they are today,
  just re-declared through `defineTheme`'s `typography` config instead of raw CSS variable
  overrides in `theme.css`. This changes nothing visually; it makes the choice theme-aware
  (e.g. correct per-heading weights) instead of a blanket override.
- **Component overrides (Q6, reversed from an initial "yes"):** leave `components` empty this
  pass. Q6 first answered "start with specific overrides now," but when asked which components
  and what should change (Q8), the answer was "not sure yet, hold off" — so Q6 reverted to
  leaving `components` empty. Astryx's own convention (per `App.tsx`) is that components are
  styled per call site via props/`xstyle`, and a theme-level override only pays off when the
  same visual change needs to land everywhere a component is used, not once.
- **Radius (Q9):** use a subtle half-scale radius in service of a restrained,
  developer-centric look. The scale is 2px (inner), 4px (element), 6px (container), and
  14px (page/chat); `defineTheme`'s `radius` config keeps those values centralized and lets
  the scale be increased later without changing component call sites.
- **Motion (Q9, implicit):** left at Neutral's defaults (fast 125ms / medium 300ms / slow
  700ms, ratio 0.75). The answer to Q9 named radius specifically and did not ask for motion to
  change, so it stays out of scope for this pass.

## Verified facts

Established by reading Astryx's source rather than by asking:

- Astryx's recommended customization path is `defineTheme({ name, extends: neutralTheme, ... })`
  — the derived theme is flattened, so its generated CSS is self-contained and doesn't need
  Neutral's CSS loaded separately.
- `defineTheme`'s `color.accent` should be used instead of hand-overriding `tokens['--color-accent']`:
  `--color-accent-muted`, `--color-text-accent`, and `--color-icon-accent` are generated as
  `var(--color-accent)` references and stay in sync automatically, but `--color-on-accent` is
  baked from the accent seed via a contrast computation and does **not** follow a raw token
  override — going through `color.accent` reseeds the whole palette correctly per color scheme.
- Neutral already ships an internal accent-flavored blue, `#0074e2`
  (`--astryx-theme-neutral-color-status-fill-accent`), used for info-flavored badges/fills, even
  though `--color-accent` itself is tied to the neutral ramp rather than that blue.
- `@astryxdesign/cli` (needed for `astryx theme build`, `astryx component`, etc.) is **not**
  currently installed in this repo's `node_modules` — it will need to be added as a devDependency
  before the built-theme workflow can run.
- Neutral's base theme artifacts (`palette.config.json`, the generated palette) are documented
  as reviewed, non-hand-edited artifacts, since CLI-driven regeneration of Neutral itself is not
  yet a supported release workflow — Kira's derived theme should never edit these directly.

## Implementation

Implemented as designed: `@astryxdesign/cli` is now a `packages/theme` devDependency;
`packages/theme/src/kiraTheme.ts` is the `defineTheme({ extends: neutralTheme, ... })` source
(accent `#ff3859`, typography folded in unchanged, `radius: { base: 4, multiplier: 0.5 }` for the
subtle half-scale radius); `packages/theme/src/built/kira.{css,js,d.ts,variants.d.ts}` are the
committed, reviewed build output (`bun run theme:build` regenerates them, `bun run theme:check`
verifies they're current); `index.tsx` and `theme.css` import the built theme instead of the raw
`neutralTheme` import. Both apps typecheck and build against it.

`radius`'s `multiplier: 0.5` restores a subtle scale (`--radius-inner` through `--radius-chat`)
and leaves `--radius-full` as Astryx's fixed 9999px pill token for badges, avatars, and toggles.
Components that are intentionally square, such as Kira's compact identity marks, remain explicit
call-site choices.

## Prototype

Before locking this in, `packages/theme/prototype/` (throwaway, deleted once the decision was
made) rendered Astryx's own `theme-showcase` template three ways, switchable via `?variant=` on
a local Vite dev server: stock Neutral, the shipped Kira theme, and a softer-radius
alternative. The shipped direction — `#ff3859` accent and a subtle half-scale radius — was
confirmed against that comparison and is now what both apps render.

## Risks

- ~~Flattening radius to near-zero is a visible, repo-wide change...~~ Resolved: reviewed via
  the prototype above and confirmed as the intended look, including the follow-on
  subtle half-scale radius.
- ~~`#ff3859` was supplied directly without a stated source...~~ Resolved: confirmed against the
  prototype as the intended final brand hex, not a placeholder.
- The half-scale keeps the product's developer-centric restraint while making the shared
  Astryx surfaces gently rounded. If a future surface needs stronger curvature, increase the
  shared multiplier rather than adding component-local radius values.

## Deferred

- **Component-level overrides (Q8)** — deferred without naming specific components. Reopens the
  moment a real, repeated visual need shows up for a specific Astryx component (e.g. the same
  button or badge variant needing the same override at multiple call sites). At that point,
  Q6 should also be revisited since it depends on this answer.

## Open threads

None — every question in the interview reached either a locked/routine decision or an explicit
defer; no discussion ended without resolution.
