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

In dark mode the shadow tokens carry about half the black of Astryx Neutral's, and each ends in a faint 1px light inset ring; that ring is the raised surface's edge, so a raised surface takes no border of its own.

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
- **Ghost at an edge:** a ghost button at the start or end of a header aligns its icon with the content beside it and lets its padding hang into the gutter, so it sits in line at rest and its hover background grows outward. How: `docs/internal/desktop-conventions.md` (Where a style goes).

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

### Work

Work is the reference for how Kira draws dense, task-shaped UI. The rules below are the direction that produced it; hold new Work UI to them rather than to what looks plausible.

**Voice and vocabulary.** People see **Ticket**, **Blocker**, and **Session**; the code's `gate` and `run` never reach the screen (`CONTEXT.md`). The same action has the same name everywhere. **Close** puts a panel away; **Resolve…** closes a ticket (Mark done or Won't do). Buttons say what they do ("Start agent", "Set up workspace"), states are short lowercase phrases ("ready for an agent", "0 of 1 closed"), and empty states say what the thing is for, in a sentence, not "No data". Server error text is shown as it comes, so the server words its refusals in the same vocabulary; neither side says "issue", "gate" or "run" to a person.

**Ledger, not cards.** Work is ruled, not boxed: hairlines, rows, and columns carry structure. Rows have no corners and no resting shadow. The only raised things are floating layers (menus, dialogs, the row's hover strip, the ticket's floating box), and a raised surface takes no border, because its shadow's inset ring is the edge. Reach for a rule or spacing before a box.

**Signal rose.** Kira red is for the one primary action, selection, and focus. Lane color (warning amber for Needs review, accent for Ready, blue Running, orange Blocked, muted Draft, green Done) marks status and nothing else. Kind is shape first (icon) and hue second (a dot), and kind hues avoid the status colors except bug's orange. Won't do is orange, never red or green; a blocker closed as won't do is a warning, not a success, and the blockers' progress bar turns orange to say so.

**Board.** Lanes are ruled columns: a hairline between lanes and a 2px status-colored rule under each header with a zero-padded mono count. A ticket is a ruled row: kind icon, mono name, and short age on the top line with the holder's initials at the right; the title; the one-line status in its lane's color; then small tags (kind dot, blockers closed, sessions, linked chats). A row's actions (Start, move to front of Ready, attach, drag handle) float in one raised strip on hover or focus. The whole row drags by pointer; the handle is the keyboard's way. The drawer sits beside the board on wide windows and covers it on narrow ones. Cross-lane drops request supported ticket actions through the confirmation bar; they never write a band directly.

**List.** The same tickets as one table: a pinned heading row (Ticket, Status, Kind, Blockers, Sessions, Owner, Updated) and groups by status or kind, each a foldable, sticky row with its lane's dot, name, count, and note. The table is one CSS grid and every group and row is a subgrid of it, so every column, heading included, lines up down the whole list; the first and last tracks are the rows' side padding, because a subgrid row cannot pad itself without squeezing its columns. Rows are 40px and reuse the board row's vocabulary. Drag works exactly as on the board (status groups and Ready order; grouped by kind nothing drags, since a drop would mean nothing), and the drawer sits beside the table. With the drawer open the table scrolls sideways rather than hiding columns.

**Toolbar: search, Filter, Display.** Search has a magnifier, a clear button, and `/` to jump into it (Escape clears and leaves). **Filter** narrows which tickets show (Status with counts, Kind with icons, Owner); **Display** says how they are arranged (Group by, Order by, Show done tickets). Never mix the two. Every option is a menu row with a check on the current one; nothing cycles its value on click. A filtered view shows removable chips and "N of M tickets" under the header, and that row exists only while something is filtered. A control that differs from its default is drawn filled (secondary), not ghost.

**Refusals.** A refusal is said where the person is looking. What is done inside a ticket's panel is refused in the panel, beside what was being done. A move made from the board or list (a drop) has no panel, and the confirmation bar is too small to read a sentence in, so its refusal is an error toast (bottom end, dismissible) and the bar stays open to try again.

**Ticket, drawer and full view.** The drawer and the full view share one header: mono name, an outlined kind tag, and a state line (toned icon plus words), then the title. The full view is a document with a floating box: the box holds the next step, Edit, a More menu (Back to draft, Stop working on it, Resolve…), then the facts, the branch, and linked chats. It sits on the same canvas as the board and list (`--color-background-surface`), so moving between them does not change the ground. A ticket offers one next step, never several equal buttons. About and Done when render Markdown (About compact, headings starting at level 4; Done when inline) and links open externally.

**Blockers.** "Blocked by" and "Blocking" are ledger rows in four aligned columns (state icon, mono name, title, where it stands) on one grid, ruled and sized like the Done-when checks above them. Above the rows, one sentence says what the blockers mean for this ticket now (waiting on N; can start; or "was closed as won't do, check it still makes sense"). Removing a blocker replaces its state word on hover rather than reserving room. Adding picks from open tickets that would not be a duplicate; a refusal (a circle of tickets) stays visible and leaves the picker open.

**New ticket.** A modal dialog over the queue, laid out like the ticket it becomes: a kind dropdown (icon and meaning per kind, with "can't change once written"), a large borderless title, About in the rich markdown editor (`markdownEditor.tsx`: bold, italic, code, lists, quote, code block; markdown in and out, so what is written is what the ticket view renders), then Done when as ruled check rows. Edit uses the same fields in place (`TicketFields` in `workNewTicket.tsx`) with the ticket's own words, so writing and correcting look identical; titles and checks are one-line-of-meaning fields that wrap rather than hide, and Enter never breaks them. ⌘/Ctrl+Enter creates or saves; a refusal shows as a banner in the dialog. It is written as a draft, so nothing insists on the checks.

**Workspace setup.** A ticket without a workspace shows a dashed "No workspace yet" row; setting up opens a dialog. Choices with known answers are pickers (the checkout, the branch it starts from, the agent) and only the new branch's name is typed, with a suggest button inside the field. A route line (from branch → new branch in checkout) shows the result before it is made. A folder that is not a git checkout says so and disables Create.

**Spacing and alignment are the craft.** These are measured, not eyeballed.

- Use the 4px rhythm: 4–8 inside a group, 12–16 between related sections, 24+ between regions. Rows are 40px on the board and list; controls are 28 (small) or 32.
- Text starts at one left edge down a whole surface: the filter bar's first word, the column headings, the group heads, and row text share a left edge (16px gutter). A ghost button at an edge is compensated so its words, not its box, sit on that line (`docs/internal/desktop-conventions.md`).
- One grid per list, so columns cannot drift. If two things are the same kind of item (a check and a blocker), they share padding, divider, size, and text weight.
- Numbers use tabular mono figures and align right or in their column.
- Truncate with an ellipsis and put the full text in `title`; never let a long title reflow a row.

**Verify before calling it done.** Screenshot the running app, in both themes when color changed, at a narrow and a wide window; measure the left edges and gaps with `getBoundingClientRect` rather than trusting the picture; test pointer and keyboard drag, focus rings, and the empty, loading, and refused states. The procedure is `docs/internal/frontend-debugging.md`.

## Do's and Don'ts

### Do:

- **Do** use Kira's semantic color, type, radius, and spacing tokens so light and dark themes stay coordinated.
- **Do** reserve Kira red for primary actions, selection, and focus; use status colors only for status.
- **Do** preserve keyboard-visible focus, readable labels, and the shared compact control sizes.
- **Do** keep Work's board interactions action-based; the server remains authoritative for ticket lanes.
- **Do** measure alignment in the running app; spacing and cohesion are the point of this system.
- **Do** say Ticket, Blocker, and Session on screen, and name the same action the same way everywhere.

### Don't:

- **Don't** substitute Astryx Neutral's default blue accent for Kira's semantic red accent.
- **Don't** add shadows to every card; keep resting surfaces tonal and lightly bordered.
- **Don't** copy Linear's visual identity into Work; use familiar issue-tracker interactions in Kira's own visual language.
- **Don't** box Work rows in cards, add a border to a shadowed surface, or cycle a filter's value on click.
- **Don't** communicate disabled, selected, or status states by color alone.
