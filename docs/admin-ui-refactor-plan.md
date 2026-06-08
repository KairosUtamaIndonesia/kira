# Admin UI Refactor Plan

A complete guide to polishing the Kira Admin dashboard's UI and UX interactions.
This document covers removals, relocations, interaction improvements, and implementation slices.

---

## 1. Global Assessment

### What is polished today

- Dark theme is consistent, shell layout is clean
- Typography and spacing use design tokens
- Tables have basic structure
- Forms have labels and validation messages

### What is unpolished

- No active navigation states
- Disabled elements without explanation
- Placeholder text reads like dev notes
- No loading, toast, or confirmation UX
- Forms permanently expanded for infrequent actions
- Tables lack row actions, badges, avatars
- Empty states are generic dashed boxes
- No mobile navigation
- No breadcrumbs on nested routes

---

## 2. Removals

These elements should be deleted entirely. Do not preserve them behind flags.

| Element                                     | Location                              | Reason                                                                                         |
| ------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Sidebar footer text                         | `AdminSidebar.tsx` bottom             | "Local admin shell. Authentication is added in the next phase" is a dev note in user-facing UI |
| Access Control permission matrix            | `access-control/page.tsx`             | Every cell reads "Display only" — it looks like a broken feature, not a read-only view         |
| Left-side role cards in Access Control      | `access-control/page.tsx`             | Duplicates the table column headers with no extra information                                  |
| Desktop access policy card                  | Org `Overview` page                   | Static paragraph with no toggle, no data, no edit capability — dead UI                         |
| Disabled search input                       | `organizations/page.tsx` table header | Disabled with no explanation or tooltip — looks broken                                         |
| Settings page placeholder cards             | `settings/page.tsx` (global)          | All four cards say "will be configured here" — empty promises, no functionality                |
| Disabled "Create user" button               | `users/page.tsx` header               | Confusing without context; remove until the feature exists                                     |
| `font-mono` on platform role                | `users/page.tsx` table cell           | Renders `admin` in monospace; looks like a code artifact, not styling                          |
| Dashboard "Recent organizations" full table | `dashboard/page.tsx`                  | Duplicates the Organizations list page with fewer columns                                      |

### Replacement strategy for removed elements

- **Access Control**: Replace the matrix with a single explanatory card:  
  _"Role permissions are managed by Better Auth and are not editable from the admin panel."_
- **Settings page (global)**: Replace placeholder cards with a single message:  
  _"Admin settings are not yet configurable from the UI."_ Or remove the page from navigation until it has content.
- **Desktop access policy**: Remove from Overview. When the feature is ready, surface it as an editable toggle card or move it to Org Settings.
- **Dashboard "Recent organizations"**: Replace with a compact 3-column card list (Name, Members, Status) or remove entirely and let Dashboard focus on metrics.

---

## 3. Relocations

| Element                        | From                                       | To                                                                                      | Reason                                               |
| ------------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Create organization form       | Expanded at top of Organizations list      | Behind a "Create organization" button that opens a dialog or expands inline             | Infrequent action, consumes prime real estate        |
| Invite member form             | Expanded at top of Members page            | Behind an "Invite member" button that expands or opens a dialog                         | Same reason — pushes the table down                  |
| Delete organization section    | Directly below rename form in Org Settings | Absolute bottom of the page with a `border-destructive` separator and confirmation step | Dangerous action should feel isolated and deliberate |
| "Manage SSO" link in Dashboard | "Settings" column in Recent orgs table     | Actions dropdown menu (View / Settings / Manage SSO) or remove the table entirely       | Misleading column label                              |

---

## 4. Interaction Improvements by Feature

### 4.1 Global Shell & Navigation

- [ ] **Active nav state**: Sidebar links should highlight the current route with `bg-sidebar-accent` or a left border accent.
- [ ] **Org tab active state**: Organization detail tab nav should highlight the active tab with `bg-primary text-primary-foreground` or an underline.
- [ ] **User menu dropdown**: Replace plain "User menu" button with a real dropdown containing user name/email, divider, and "Sign out".
- [ ] **Environment badge**: Keep the "Local" badge but add subtle visual weight (a dot icon with color, or a subtle badge background).
- [ ] **Mobile sidebar**: Add a hamburger/menu button in the header that opens a sheet/drawer with nav links on small screens.
- [ ] **Breadcrumbs**: Add breadcrumbs on nested pages: `Organizations > Kairos > Members`. Use a `Breadcrumb` component or simple inline nav.

### 4.2 Dashboard

- [ ] **Metric card icons**: Add Lucide icons (`Building2`, `Users`, `ShieldCheck`, `Globe`) to each metric card with a subtle tinted background circle.
- [ ] **Metric card hover**: Add `hover:shadow-md` or `hover:scale-[1.01]` micro-interaction.
- [ ] **SSO empty state**: Replace generic dashed box with an illustrated empty state + "Configure SSO" button.
- [ ] **Recent organizations simplification**: Either remove the full table or collapse to a compact card list. If kept, add an overflow menu per row.

### 4.3 Organizations List

- [ ] **Create form relocation**: Move behind a button (see Relocations above).
- [ ] **Row hover**: Add `hover:bg-muted` to table rows.
- [ ] **Status badges**: Use `<Badge>` component with color semantics: green for Active, yellow for Pending.
- [ ] **Row actions**: Add an overflow menu (`...`) at the end of each row with: "View", "Settings", "Manage SSO".
- [ ] **Empty state**: Add a Lucide icon (`Building2`) to the empty state and a "Create your first organization" CTA button.
- [ ] **Search**: Either wire up or remove the disabled input.

### 4.4 Organization Overview

- [ ] **Summary card icons**: Add icons to Members, API Keys, Status cards. Use color for Status (green dot for Active).
- [ ] **Remove dead UI**: Delete the Desktop access policy card (see Removals).

### 4.5 Members

- [ ] **Invite form relocation**: Move behind a button (see Relocations above).
- [ ] **Role select styling**: Replace native `<select>` with shadcn `<Select>` component for consistency.
- [ ] **Save/Remove hierarchy**: "Save role" should be a subtle secondary button; "Remove" should be a ghost destructive button with a trash icon.
- [ ] **Remove confirmation**: Add a confirmation dialog: _"Remove {name} from {org}? This cannot be undone."_
- [ ] **User avatars**: Add initials-circle avatars next to member names.

### 4.6 API Keys

- [ ] **Empty state icon**: Add `KeyRound` icon to the empty state.
- [ ] **Row actions** (when keys exist): Add "Copy" (with clipboard success toast) and "Revoke" (with confirmation dialog).

### 4.7 Organization Settings

- [ ] **Active org feedback**: Show a Sonner toast after "Set active": _"Kairos is now your active organization."_
- [ ] **SSO form helper text**: Add field-level helper text (e.g., "Find your Tenant ID in Azure Active Directory > Properties").
- [ ] **Button loading states**: Disable submit buttons and show a spinner while server actions are pending.
- [ ] **Delete section isolation**: Move to bottom with a clear `border-destructive` separator. Add a confirmation step requiring typing the org name.
- [ ] **Rename feedback**: Show a toast on success or error.

### 4.8 Users (Platform)

- [ ] **Remove disabled button**: Delete the disabled "Create user" button (see Removals).
- [ ] **Role badges**: Use `<Badge>` instead of `font-mono` text.
- [ ] **Avatars**: Add initials-circle avatars.
- [ ] **Row actions**: Add overflow menu with "View organizations", "Suspend", "Delete" (even if some are placeholders for now).

### 4.9 Access Control

- [ ] **Replace matrix**: Remove the full table and left-side cards. Use a single informational card explaining that permissions are managed by Better Auth.
- [ ] **Badge**: Add a "Coming soon" or "Read-only" badge to set expectations.

### 4.10 Settings (Global)

- [ ] **Remove placeholders**: Delete the four placeholder cards.
- [ ] **Single message**: Show one centered card: _"Admin settings are not yet configurable from the UI."_
- [ ] **Alternative**: Remove the Settings nav item entirely until the page has real content.

### 4.11 Auth / Sign-In

- [ ] **Button loading state**: Disable the form and show a spinner on the submit button while `signIn` is in flight.
- [ ] **Password visibility toggle**: Add an eye icon to show/hide password.
- [ ] **Forgot password link**: Add a "Forgot password?" link (can be a placeholder href for now).

---

## 5. Cross-Cutting Concerns

### 5.1 Toast Notifications

Add a global toast system (Sonner) and wire it to all server actions:

- Organization created/deleted/renamed
- Member invited/role updated/removed
- SSO registered
- Active organization set
- API key created/revoked
- Errors with messages from server actions

### 5.2 Loading States

Replace all `Suspense` text fallbacks with proper skeleton components:

- `MetricCardSkeleton` (for dashboard)
- `TableSkeleton` (for organizations, users, members, API keys)
- `FormSkeleton` (for settings forms)

Use `shimmer` animation via Tailwind `animate-pulse` or a custom shimmer class.

### 5.3 Confirmation Dialogs

Create a reusable `ConfirmDialog` component and use it for:

- Delete organization
- Remove member
- Revoke API key
- Any future destructive action

### 5.4 Form State

All forms should:

- Disable submit button while pending
- Show a spinner inside the button
- Re-enable on success or error
- Clear password fields on error (sign-in)
- Scroll to first error field on validation failure

### 5.5 Focus Management

- Return focus to the trigger button after closing a dialog
- Focus the first input when opening a create/invite dialog
- Trap focus inside modals

### 5.6 Keyboard Support

- `Esc` closes dialogs and dropdowns
- `Enter` submits forms when focused on inputs
- Arrow keys navigate dropdowns and selects

---

## 6. Workable Implementation Slices

These are ordered by impact and risk. Each slice is designed to be a single PR or a focused session of work.

### Slice 1: Cleanup — Remove Dead UI

**Goal:** Eliminate placeholder text, disabled elements, and dead components that make the app look unfinished.

**Files to touch:**

- `apps/admin/features/admin-shell/components/AdminSidebar.tsx` — remove footer text
- `apps/admin/app/(admin)/organizations/page.tsx` — remove disabled search input
- `apps/admin/app/(admin)/users/page.tsx` — remove disabled "Create user" button, remove `font-mono` from role
- `apps/admin/app/(admin)/organizations/[organizationId]/access-control/page.tsx` — replace matrix with info card
- `apps/admin/app/(admin)/organizations/[organizationId]/page.tsx` — remove Desktop access policy card
- `apps/admin/app/(admin)/settings/page.tsx` — replace placeholder cards with single message
- `apps/admin/app/(admin)/dashboard/page.tsx` — remove or simplify "Recent organizations" table

**Acceptance:** No placeholder "will be configured here" text remains. No disabled inputs without explanation. No dev notes in user UI.

---

### Slice 2: Navigation Polish — Active States, Mobile, Breadcrumbs

**Goal:** Users always know where they are and can navigate on any screen size.

**Files to touch:**

- `apps/admin/features/admin-shell/components/AdminSidebar.tsx` — add active state to nav links
- `apps/admin/features/admin-shell/components/AdminHeader.tsx` — add mobile menu button + sheet
- `apps/admin/features/organizations/components/OrganizationHeader.tsx` — add active state to tab nav
- Create `Breadcrumb` component in `components/ui/` or use inline nav
- Add breadcrumbs to org detail pages

**Acceptance:** Sidebar highlights current route. Org tabs highlight current tab. Mobile shows a hamburger that opens a nav drawer. Breadcrumbs appear on nested pages.

---

### Slice 3: Global Toast + Confirmation System

**Goal:** Every user action has feedback. Destructive actions require confirmation.

**Files to touch:**

- Install `sonner` (if not already installed)
- Add `<Toaster />` to `app/layout.tsx` or `AdminShell.tsx`
- Create `components/ui/confirm-dialog.tsx` — reusable ConfirmDialog
- Wire ConfirmDialog to: delete org, remove member, revoke API key
- Add toasts to all server action handlers

**Acceptance:** Creating an org shows a success toast. Deleting an org opens a confirmation dialog first. Errors show red toasts with server messages.

---

### Slice 4: Loading Skeletons

**Goal:** Replace all "Loading..." text with proper skeleton UI.

**Files to touch:**

- `apps/admin/components/ui/skeleton.tsx` (create or extend)
- `apps/admin/app/(admin)/dashboard/page.tsx` — `DashboardLoading`
- `apps/admin/app/(admin)/organizations/page.tsx` — `OrganizationsTableLoading`
- `apps/admin/app/(admin)/users/page.tsx` — `UsersTableLoading`
- `apps/admin/app/(admin)/organizations/[organizationId]/page.tsx` — `SummaryLoading`
- `apps/admin/app/(admin)/organizations/[organizationId]/members/page.tsx` — `MembersTableLoading`
- `apps/admin/app/(admin)/organizations/[organizationId]/api-keys/page.tsx` — `ApiKeysTableLoading`

**Acceptance:** All Suspense fallbacks render skeleton shapes (rectangles, circles) with pulse animation. No plain text "Loading..." remains.

---

### Slice 5: Form Relocations + Dialog Pattern

**Goal:** Infrequent forms don't clutter the main view.

**Files to touch:**

- `apps/admin/features/organizations/components/CreateOrganizationForm.tsx` — wrap in a dialog or inline-expand behind a button
- `apps/admin/features/organizations/components/OrganizationMemberForms.tsx` — wrap `InviteMemberForm` in a dialog or expand behind a button
- `apps/admin/app/(admin)/organizations/page.tsx` — update to use the new button/dialog pattern
- `apps/admin/app/(admin)/organizations/[organizationId]/members/page.tsx` — update to use the new button/dialog pattern

**Acceptance:** Organizations list shows a "Create organization" button, not a form. Members page shows an "Invite member" button, not a form. Clicking opens a dialog with the form.

---

### Slice 6: Table Polish — Hover, Badges, Avatars, Row Actions

**Goal:** Tables feel modern and actionable.

**Files to touch:**

- `apps/admin/app/(admin)/organizations/page.tsx` — row hover, status badges, overflow menu
- `apps/admin/app/(admin)/users/page.tsx` — row hover, role badges, avatars, overflow menu
- `apps/admin/app/(admin)/organizations/[organizationId]/members/page.tsx` — row hover, avatars, overflow menu
- Create `components/ui/avatar.tsx` (or use existing if available)
- Create `components/ui/badge.tsx` (or use existing if available)

**Acceptance:** All tables have hover states. Status and roles use colored badges. Members and users show initials-circle avatars. Overflow menus contain relevant actions.

---

### Slice 7: Org Settings Form Polish

**Goal:** Forms in Org Settings feel responsive and safe.

**Files to touch:**

- `apps/admin/features/organizations/components/OrganizationSettingsForms.tsx`
  - Add helper text to SSO fields
  - Add loading spinners to all submit buttons
  - Add toast feedback for all actions
  - Move Delete section to bottom with destructive border
  - Add org-name confirmation to delete flow
- `apps/admin/app/(admin)/organizations/[organizationId]/settings/page.tsx` — pass any needed props

**Acceptance:** "Set active" shows a toast. SSO form buttons show spinners. Delete requires typing the org name. Rename shows success/error toast.

---

### Slice 8: Sign-In Polish

**Goal:** The auth experience feels smooth and trustworthy.

**Files to touch:**

- `apps/admin/features/auth/components/SignInForm.tsx` — add loading state, password visibility toggle
- `apps/admin/app/(auth)/sign-in/page.tsx` — add "Forgot password?" link

**Acceptance:** Submitting the form disables inputs and shows a spinner. Password can be shown/hidden. A "Forgot password?" link is visible.

---

### Slice 9: Metric Card Enhancements + Dashboard Cleanup

**Goal:** Dashboard feels like a real overview, not a data dump.

**Files to touch:**

- `apps/admin/app/(admin)/dashboard/page.tsx`
  - Add icons to `MetricCard`
  - Add hover micro-interactions
  - Replace or simplify "Recent organizations"
  - Improve SSO empty state with icon + CTA

**Acceptance:** Each metric card has a relevant icon. Cards lift on hover. SSO empty state has a `ShieldCheck` icon and a "Configure SSO" button.

---

### Slice 10: Members Page Deep Polish

**Goal:** The members page is a high-touch area — it needs to feel excellent.

**Files to touch:**

- `apps/admin/features/organizations/components/OrganizationMemberForms.tsx`
  - Replace native `<select>` with shadcn `<Select>`
  - Style "Save role" as secondary, "Remove" as ghost destructive with trash icon
  - Wire ConfirmDialog to Remove
- `apps/admin/app/(admin)/organizations/[organizationId]/members/page.tsx`
  - Add avatars to table rows

**Acceptance:** Role changes use a styled dropdown. Remove has a confirmation dialog. Members have avatars.

---

## 7. Design Conventions

Follow these conventions for consistency across all slices:

- Use `shadcn/ui` components (Button, Badge, Select, Dialog, Avatar, Skeleton) — do not reinvent.
- Use Lucide icons. Match icons to concepts: `Building2` (org), `Users` (members), `ShieldCheck` (SSO), `KeyRound` (API keys), `Trash2` (delete), `Pencil` (edit).
- Color semantics: `green` = active/success, `yellow` = pending/warning, `red` = destructive/error, `blue` = info/link.
- All destructive buttons use `variant="ghost"` with `text-destructive` and a destructive icon.
- All primary actions use `variant="default"`.
- All secondary/outline actions use `variant="outline"`.
- All disabled states must have a visible reason (tooltip, helper text, or remove the element).
- Use `transition-all duration-200` for hover/focus micro-interactions.
- Empty states always include an icon and a CTA when appropriate.

---

## 8. Verification Checklist

After all slices are complete, verify:

- [ ] No placeholder text like "will be configured here" remains
- [ ] No disabled inputs or buttons without explanation
- [ ] Active nav state works on all routes including org tabs
- [ ] Mobile sidebar opens and closes correctly
- [ ] All server actions show a toast (success or error)
- [ ] All destructive actions show a confirmation dialog
- [ ] All forms have loading states on submit buttons
- [ ] All Suspense fallbacks render skeletons, not text
- [ ] Tables have hover states and row actions
- [ ] Status and roles render as colored badges
- [ ] Members and users display avatars
- [ ] Sign-in form has loading state and password toggle
- [ ] No `console.log` or `console.error` in frontend code
- [ ] `bun run lint` and `bun run format:check` pass
