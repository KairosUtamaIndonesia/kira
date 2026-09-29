---
name: Kira Desktop
description: A calm, exact visual system for local-first coding work.
colors:
  primary: 'light-dark(#D4203F, #FF3859)'
  neutral-body: 'light-dark(#F7F6F4, #171615)'
  neutral-bg: 'light-dark(#FDFCFA, #120F0E)'
  neutral-surface: 'light-dark(#F8F7F5, #181715)'
typography:
  display:
    fontFamily: '"Satoshi Variable", "Inter Variable", system-ui, sans-serif'
    fontSize: '2.625rem'
    fontWeight: 400
    lineHeight: 1.2381
  headline:
    fontFamily: '"Satoshi Variable", "Inter Variable", system-ui, sans-serif'
    fontSize: '1.5rem'
    fontWeight: 600
    lineHeight: 1.3333
  title:
    fontFamily: '"Satoshi Variable", "Inter Variable", system-ui, sans-serif'
    fontSize: '1.25rem'
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: '"Inter Variable", system-ui, sans-serif'
    fontSize: '0.875rem'
    fontWeight: 400
    lineHeight: 1.4286
  label:
    fontFamily: '"Inter Variable", system-ui, sans-serif'
    fontSize: '0.875rem'
    fontWeight: 500
    lineHeight: 1.4286
  code:
    fontFamily: '"Geist Mono Variable", ui-monospace, monospace'
    fontSize: '0.875rem'
    fontWeight: 400
    lineHeight: 1.4286
rounded:
  none: '0px'
  inner: '2px'
  element: '4px'
  container: '6px'
  page: '14px'
  full: '9999px'
spacing:
  xs: '4px'
  sm: '8px'
  md: '12px'
  lg: '16px'
  xl: '24px'
components:
  button-primary:
    backgroundColor: '{colors.primary}'
    textColor: 'var(--color-on-accent)'
    rounded: '{rounded.element}'
    height: '32px'
    padding: '8px 12px'
  button-secondary:
    backgroundColor: 'var(--color-neutral)'
    textColor: 'var(--color-text-primary)'
    rounded: '{rounded.element}'
    height: '32px'
    padding: '8px 12px'
  button-ghost:
    backgroundColor: 'transparent'
    textColor: 'var(--color-text-primary)'
    rounded: '{rounded.element}'
    height: '32px'
    padding: '8px 12px'
  button-destructive:
    backgroundColor: 'var(--color-error)'
    textColor: 'var(--color-on-error)'
    rounded: '{rounded.element}'
    height: '32px'
    padding: '8px 12px'
  input-search:
    backgroundColor: '{colors.neutral-surface}'
    textColor: 'var(--color-text-primary)'
    rounded: '{rounded.element}'
    height: '32px'
    padding: '0 12px'
  navigation-item:
    backgroundColor: 'var(--color-background-muted)'
    textColor: 'var(--color-text-secondary)'
    rounded: '{rounded.element}'
    height: '32px'
    padding: '4px 8px'
  status-chip:
    backgroundColor: 'var(--color-warning)'
    textColor: 'var(--color-on-warning)'
    rounded: '{rounded.full}'
    height: '20px'
    padding: '2px 8px'
  work-ticket-row:
    backgroundColor: 'transparent'
    textColor: 'var(--color-text-primary)'
    rounded: '{rounded.none}'
    padding: '10px 16px'
---

# Design System: Kira Desktop

## Overview

**Creative North Star: “Quiet control room”**

Kira Desktop is calm and exact: a warm, low-glare workspace where project context, conversation, and the state of active work stay legible without decorative noise. The system pairs tonal surfaces and fine borders with restrained elevation; controls feel crisp and lightly lifted rather than glossy or ornamental.

Kira red is the semantic action and focus accent, authored separately for light and dark themes with a foreground that clears 4.5:1 in each. Typography and spacing do the routine work of hierarchy; color is reserved for actions, focus, and meaningful state.

**Key Characteristics:**

- Warm ink and warm paper neutrals with no accent hue in them.
- Kira red for primary actions, selected states, and keyboard focus.
- Compact, keyboard-friendly controls inside a persistent desktop shell.

## Colors

The palette is warm ink (dark) and warm paper (light): low-chroma, faintly brown neutrals with no accent hue in them, modeled on OpenChamber's default theme. Light and dark modes are paired by semantic tokens so components keep the same role in either scheme. Every color is authored per role in `packages/theme/src/kiraTheme.ts`; don't reintroduce the `color.accent` seed, which bleeds the accent's hue into the neutrals.

### Primary

- **Kira red** (`colors.primary`): the brand red `#FF3859` in dark mode with near-black text on it; a deeper `#D4203F` in light mode so white text clears 4.5:1. Used for primary actions, selected emphasis, and focus. Use the semantic accent token so its light/dark contrast pairing stays intact.

### Neutral

- **Frame** (`colors.neutral-body`): the sidebar and app frame, one small step off the canvas.
- **Canvas** (`colors.neutral-bg`): the working area where chats and boards sit.
- **Raised surface** (`colors.neutral-surface`): cards and controls. Steps between surfaces are deliberately small (≈1.05:1); borders do most of the separating.
- **Hover and pressed**: translucent overlays of the foreground (white in dark, black in light), not separate fills.
- **Primary and secondary text** (`--color-text-primary`, `--color-text-secondary`): use the semantic text pair for readable hierarchy; do not approximate secondary text with opacity.
- **Borders** (`--color-border`, `--color-border-emphasized`): quiet separators at rest, stronger strokes for focus and interactive boundaries.
- **Status colors** (`--color-success`, `--color-warning`, `--color-error`): reserve semantic green, amber, and red for their corresponding outcomes rather than using them as decoration.

## Typography

**Display Font:** Satoshi Variable (with Inter Variable and system sans-serif fallbacks)  
**Body Font:** Inter Variable (with system sans-serif fallback)  
**Label/Mono Font:** Inter Variable for labels; Geist Mono Variable for code.

**Character:** Satoshi gives headings a distinct, compact voice; Inter keeps dense controls and supporting copy plain and quickly scannable. Geist Mono is reserved for code and technical identifiers.

### Hierarchy

- **Display** (400, `2.625rem`, `1.2381` line-height): large page or product-level headings.
- **Headline** (600, `1.5rem`, `1.3333` line-height): section headings.
- **Title** (600, `1.25rem`, `1.4` line-height): panel and group titles.
- **Body** (400, `0.875rem`, `1.4286` line-height): standard interface copy.
- **Label** (500, `0.875rem`, `1.4286` line-height): controls, compact headings, and metadata.
- **Code** (400, `0.875rem`, `1.4286` line-height): code and technical values.

## Layout

The desktop shell keeps navigation persistent and lets each working surface own the remaining space. Use the shared 4px spacing rhythm: close groups use 4–8px, related sections 12–16px, and major regions 24px or more. Dense data may be compact, but it should retain clear grouping and comfortable hit targets.

Responsive layouts preserve the same task order: panels move beside content on wide windows and overlay it on narrower ones; controls wrap or stack before they become clipped. In Work, the six server-derived lanes scroll horizontally, while each lane keeps its own vertical card list. These are Work-surface rules, not a requirement that every Kira screen use columns.

## Elevation & Depth

Depth is lightly lifted and mostly tonal. Canvas, surface, muted, and popover tokens establish the resting hierarchy; borders define cards and controls. Use the existing low-to-high shadow tokens for floating layers such as menus, dialogs, or popovers, not as a permanent halo around every card. Work lanes and ticket cards remain quiet at rest, with surface contrast and a fine border carrying most of their separation.

**The Quiet Surface Rule.** Keep resting cards tonal and lightly bordered; use shadow only when a floating layer needs separation.

## Shapes

Corners are gently rounded, with a deliberate scale from tight inner details (2px), through controls (4px) and containers (6px), to page/chat surfaces (14px). Status chips and count pills use the full pill radius. Borders are thin and low contrast by default; use dashed outlines only for empty or drop-target states. Work's project rows and lanes use a local 10px radius as a surface-specific treatment.

## Components

Components are crisp and lightly lifted. Prefer Astryx primitives and Kira theme tokens over one-off controls; preserve visible keyboard focus and distinct disabled, loading, and semantic status states.

### Buttons

- **Shape:** gently rounded controls (4px); standard height is 32px, with the shared small and large sizes at 28px and 36px.
- **Primary:** semantic Kira red fill with the theme-selected on-accent text; standard horizontal padding is 12px.
- **Hover / Focus:** use Astryx's restrained interaction overlay and the 2px accent focus outline with 3px offset.
- **Secondary / Ghost / Destructive:** secondary uses a neutral fill, ghost stays transparent until interaction, and destructive is reserved for consequential removal or closure.

### Chips

- **Style:** compact, full-pill badges; use semantic status variants or neutral treatment for counts and supporting labels.
- **State:** status color identifies meaning; selection and action emphasis use Kira red instead of introducing another brand accent.

### Cards / Containers

- **Corner Style:** 6px by default; Work chooser rows use 10px. Work board lanes and rows have no corners: they are ruled, not boxed.
- **Background:** use the surface token for primary cards and the muted token for secondary groupings.
- **Shadow Strategy:** flat at rest; reserve the low and medium theme shadows for genuinely floating layers.
- **Border:** a 1px semantic border; selected, focused, or hovered states may strengthen it.
- **Internal Padding:** use the 8px/12px/16px spacing steps according to content density.

### Inputs / Fields

- **Style:** surface fill, 1px emphasized border, 4px radius, and a 32px standard control height.
- **Focus:** shift the boundary to the semantic accent and retain a visible keyboard outline.
- **Error / Disabled:** use semantic status tokens; disabled controls stay perceivable and do not rely on color alone.

### Navigation

- **Style:** keep the app's persistent navigation quiet at rest; use primary text for the active destination, secondary text for inactive items, and a muted accent surface for selected emphasis. Preserve keyboard focus and the compact mobile navigation affordance.

### Work Board

The Work board is a Kira-native triage surface laid out as a ledger: review and Ready appear before running, blocked, draft, and done work. Lanes are ruled columns — no box, a hairline between lanes, and a 2px status-colored rule under each header with a zero-padded mono count. Tickets are ruled rows, not cards: kind shape icon, mono name, and short age on the top line with the holder's initials at the right; the title; the one-line status in its lane's color; then small tags for kind (hue dot), blockers closed, runs, linked chats, and chat context. Kinds read apart by shape first and hue second; kind hues avoid the status colors except bug's orange. A row's actions — Start, move to the front of Ready, attach, and the drag handle — float in one small raised strip over its top line on hover or focus; it is the only raised thing on the board. The whole row drags by pointer; the handle is the keyboard's way to move it. The inspector stays beside the board on wide windows and covers it on narrow ones. Cross-lane drops request supported ticket actions; they do not write a band directly.

## Do's and Don'ts

### Do:

- **Do** use Kira's semantic color, type, radius, and spacing tokens so light and dark themes stay coordinated.
- **Do** reserve Kira red for primary actions, selection, and focus; use status colors only for status.
- **Do** preserve keyboard-visible focus, readable labels, and the shared compact control sizes.
- **Do** keep Work's board interactions action-based; the server remains authoritative for ticket lanes.

### Don't:

- **Don't** substitute Astryx Neutral's default blue accent for Kira's semantic red accent.
- **Don't** add shadows to every card; keep resting surfaces tonal and lightly bordered.
- **Don't** copy Linear's visual identity into Work; use familiar issue-tracker interactions in Kira's own visual language.
- **Don't** communicate disabled, selected, or status states by color alone.
