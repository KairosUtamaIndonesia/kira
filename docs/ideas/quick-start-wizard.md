# Quick-Start Wizard

## Problem Statement

How might we help a freshly-signed-in user understand what Kira is, choose their preferred working style, and feel set up for success — without getting in the way of people who just want to get to work?

## Recommended Direction

A 3-step Dialog wizard that fires once after first sign-in, always-skippable, covering mode choice → notification sound → theme preference. A "Reset onboarding" affordance in settings allows re-opening it.

The wizard lives between `SignInGate` and `Shell` in the component tree. A completion flag (`localStorage` or a persisted preference) gates whether the wizard appears. Each step has a "Skip all" button and auto-advances on selection — nothing requires a button press.

## Key Assumptions to Validate

- [ ] Users can make an informed mode choice from a visual comparison (side-by-side mockups of Code vs Cowork layouts) — validate with one or two users before building the full comparison view.
- [ ] The sound step won't overwhelm — test with 3-5 curated options vs the full picker before committing to scope.
- [ ] Auto-detect handles theme well enough that the theme step isn't just padding — if data shows >80% of users accept the default, drop the step.
- [ ] "Skip all" on every step is sufficient trust — users who skip want _zero_ friction, not a delayed prompt.

## MVP Scope

**In scope (Phase 1):**

1. `OnboardingWizard` component — a multi-step dialog using the existing shadcn `Dialog` primitive
2. `useOnboardingStore` (zustand) — `completed` flag persisted to localStorage (key: `kira.onboarding-completed`), with `complete()` and `restart()`
3. Wizard mounted alongside `Shell` inside `SignInGate` as a controlled modal (`open={!completed}`) — not a gate that swaps `Shell` out; this makes "Replay quick start" reopen it over any surface
4. Step 1: Mode choice — side-by-side description cards for Code vs Cowork; "You can switch anytime" note
5. Step 2: Notification sound — reuse `NotificationSettingsProvider` + the existing sound picker to show 3-5 curated sounds with preview; "More in settings" link
6. Step 3: Theme preference — Light / Dark cards (`AppearanceTheme` has no "system" value); selecting applies the theme live
7. "Skip" button on every step; Escape/backdrop dismissal also completes
8. "Replay quick start" button in the General settings section

**Out of scope (Phase 1):**

- Animated transitions between steps
- Analytics dashboard for onboarding funnel
- Role-based branching (different steps per user type)
- Project creation as part of onboarding
- Agent-led onboarding

## Not Doing (and Why)

- **Animated walkthrough (scrim/callouts)** — high build cost, ages poorly, conflicts with Dialog container decision.
- **Role-based personalization** — high content cost for uncertain benefit; MVP validates whether mode choice alone suffices.
- **Agent-led onboarding** — the agent is text-only and not the right vehicle for UI configuration choices; revisit if we build tutorial/project templates.
- **Inline hints / contextual layers** — scatters the experience; users may never discover mode choice. Dialog wizard is intentionally focused and fire-and-forget.
- **Project creation in onboarding** — too heavy for a 3-step wizard; projects are a multi-step flow with their own UX.

## Open Questions

- Should the mode choice step include a "Show me both" live preview (switch shell without committing) or is a static comparison sufficient?
- Should the completion flag be stored in the Rust persistence store (SQLite) rather than localStorage, for multi-device consistency? (Depends on when cloud sync lands.)
