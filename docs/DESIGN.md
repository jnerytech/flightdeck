# Flightdeck design rules

How the desktop app's screens are built, for people and for AI sessions that change them.

- **The tokens** are in `apps/desktop/src/styles.css`.
- **The components** are in `apps/desktop/src/components/`. Before you add a component, look for
  one that fits. One component per pattern.
- **The decisions** behind these rules are in `docs/DECISIONS.md`.
- **The audit** that started this page is issue #168.

## Tokens

The theme is the `dark` class on `<html>`, so `styles.css` has two token blocks: `:root` for light
and `.dark` for dark. Screens use the tokens through Tailwind (`bg-card`, `text-muted-foreground`,
`border-input`). They never use Tailwind's palette (`bg-red-500`) and never use fixed colours: the
style lint rejects both.

**Surfaces**, from lowest to highest:
- `--background`, the app's background;
- `--surface-1`, panels, cards and the composer (`--card` is the same token);
- `--surface-2`, inset areas, also `--muted` and `--secondary`;
- `--popover`, menus and popovers.

**Text and lines:**
- Text: `--foreground` and `--muted-foreground`.
- `--border` draws decoration only: dividers and card edges.
- `--input` draws a control's edge: inputs, selects, textareas, the unchecked switch. It keeps 3:1
  against the surfaces fields sit on, in both themes (WCAG 1.4.11). Any field that draws a border
  uses `border-input`.

**Accent:** `--brand` is the one accent: the primary button, the focus ring and the active item.
`--primary` and `--ring` point to it.

**Status:** `--status-running`, `-needs-you`, `-idle`, `-ended`, `-error` and `-risk`. Each reads at
4.5:1 as text on the background, both surfaces and the sidebar. Colour is never the only sign of a status: `StatusDot` gives each
state a shape and a label.

**Clients:** `--client-*` are a client's colour dot. The same values serve both themes, and the
client's name always goes with the dot.

**Type:** 12, 13, 14, 16, 20 and 24 px (`text-xs` to `text-2xl`).
- 13 px (`text-sm`) is the body.
- Weights are 400 for text, 500 for labels and 600 for titles and primary actions.
- Inter is the interface font; the system monospace is for commands and code.

**Spacing:** the gaps are 4, 8, 12, 16, 24 and 32 px (`Gap` 1, 2, 3, 4, 6 and 8 in
`components/layout/stack.tsx`). Forms always use 16 px between fields, 4 px from a label to its
control, and 8 px between buttons.

**Radius:** 6 px for chips, 8 px for controls, 12 px for panels.

**Motion:** 120 to 180 ms, ease-out. Nothing moves under `prefers-reduced-motion`: use
`motion-safe:` for any animation.

## Layout: named styles, not utility soup

- A screen (`src/ui/*.tsx`) composes layout primitives (`Page`, `Section`, `Panel`, `Stack`,
  `Inline`, `Grid`, `FieldRow`) and the named styles of `styles.css` (`@utility …`).
- The layout ratchet (`apps/desktop/layout-baseline.json`) counts the raw layout utilities each
  screen still holds. A screen may never go over its count. When a change lowers a count, run
  `bun run layout:ratchet`.
- Allowed in a screen without counting: `w-full`, `h-full`, `min-w-0`, `min-h-0` and the `m*-auto`
  margins.
- A named style has one definition. A test fails when a `@utility` name is defined twice:
  Tailwind v4 silently merges the two, and every element that used the first one changes.
- Size screens to their **area**, not the window: each area is a container, and grids use the
  container variants (`@2xl`, `@3xl`, `@5xl`, `@7xl`). A test rejects `sm:`, `md:`, `lg:` and `xl:`
  in screens; dialogs and sheets are exempt, since they size to the window.

## Components, one per pattern

| Pattern | Component | Notes |
|---|---|---|
| A screen | `Page` (`layout/page.tsx`) | Title, subtitle, actions on the right, an optional toolbar, and a body that scrolls by itself. Emits `data-slot="page"`; its actions are `data-slot="page-actions"`. |
| A titled block of a page | `Section` | `data-slot="section"`. |
| A bordered block | `Panel` | `title` plus `label` (a named region), and a `slot` for the layout guards, for example `card-details` and `card-run`. |
| A form | `Form`, `Field`, `FormActions` (`layout/form.tsx`) | Labels above the fields. `Field` links the help and the error to the control. Primary button last: at the right in a dialog, at the fields' left edge elsewhere. Enter submits (a real `<form>`). |
| A field and its own button on one line | `FieldRow`, or the `field-with-action` style | `FieldRow` wraps and shows one reason line under the row for a disabled button in it. `field-with-action` keeps the field and its button on one line, with the field taking the width. |
| A select | `NativeSelect` | Sized like an `Input`, with `border-input`. |
| Several choices | A `fieldset` + `legend` with one labelled checkbox each (`hit-control`) | Never `<select multiple>`: a plain click drops the other choices (#237). |
| A button whose work takes time, or that can be disabled | `ActionButton` (`feedback/action-button.tsx`) | Busy at once while the promise it returns is pending. `disabledReason` says why it is off, next to it, and links it with `aria-describedby`. |
| An icon-only action | `IconActionButton`, or `IconTip` for an icon-only control | It has a name and a tooltip; never a native `title` for text a person needs. |
| A status | `StatusDot`, `StatusText` (`components/status/`) | A shape plus a label for each state, not colour alone. |
| A tab's badge | `TabBadgeGlyph` (in `ui/TabBar.tsx`) | A glyph named in words (`role="img"`), never a text pill. It becomes `StatusDot` once #146 lands. |
| A keyboard shortcut | `Keycap` and `ShortcutKeys` (`components/shortcuts/keycap.tsx`, #165, once merged) | The only place that draws a `<kbd>`, written for the platform: Ctrl, or ⌘ on a Mac. No shortcut on Cancel or Dismiss buttons, or on links. |
| A list row | `ListRow`, and the list-row rule below | |
| Empty, loading, failed | `EmptyState`, `LoadingState`, `ErrorState` (`layout/states.tsx`) | An empty state says what to do next; a failure says what happened and offers Try again. |
| A message in a page | `InlineNotice` (`feedback/inline-notice.tsx`) | `role="alert"` or `"status"`, depending on the tone. |
| A list beside its detail | `SplitView` | Below 560 px of area it shows one pane, with a way back. |
| A host that does not answer | `HostOfflineBanner` | Why, the last try, and Reconnect now. A host screen shows it instead of a spinner that never ends (#227, from v0.36.5). |

The audit of keycaps, tooltips, loading and back-out buttons is in `docs/DECISIONS.md`, in the
section "Keycaps, tooltips, loading and back-out buttons: the one-pass audit" (#165).

## Rules

**List rows.** The title takes the width (`flex-auto`, `min-w-0`, `truncate`); the meta gives way
first. Meta that every row of a group shares goes once in the group's header. A line that can be cut
has `truncate`, and its full text in its accessible name or its tooltip. The base layer gives
buttons `align-items: stretch`, so a line stacked inside a button has the button's width (#175).

**Buttons.**
- One primary action per form or dialog, placed last.
- A disabled button says why, next to it (`disabledReason`). Never silently.
- A destructive action asks first with `ConfirmDialog`, with the verb on the button ("Remove", not
  "OK"). Only the irreversible action is `variant="destructive"`.
- An async button shows it is busy within 100 ms.
- Every pointer target is at least 24 × 24 px (`hit-24`, `hit-inline`, `hit-control`,
  `hit-switch`).

**Fields.**
- Every field has a visible label (a `<label for>`, through `Field`). A placeholder is never the
  only label.
- A field that shows saved data follows that data until the person edits it (`useDraft`,
  `lib/use-draft.ts`).
- A save never sends a value the person did not edit. A field that changed elsewhere while being
  edited stops a plain Save, says why, and offers "Use theirs" (#170, #226).

**Copy.**
- Every text a person sees comes from both dictionaries (`i18n/en.ts` and `pt-BR.ts`).
- The same verb for the same action everywhere: Approve and Deny for a request.
- An error says what happened and what to do. When the daemon's own words matter, they go under
  Details, after a sentence from the catalog.
- One sentence says a thing once.

**States.** Every screen covers loading, empty, error, success and long content. A screen that waits
for its host says when the host is down, instead of waiting forever.

## Test anchors and `data-slot` names

The policy is in `docs/TDD.md`, under "Test anchors". These are the `data-slot` names the app owns:
- `page`, `page-actions`, `section`;
- `card-details`, `card-run`;
- `timeline`, `composer-card`, `recap`, `session-controls`, `session-extra`, `session-status`;
- `session-tile`, `session-card`, `sidebar-hosts`, `native-select`, `task-chip`, `unread-dot`.

A request card carries `data-request-id`. The names from the vendored `components/ui` (`button`,
`dialog-*`, `tabs-*`, `scroll-area-viewport`, …) are shadcn's: a guard may show them, but no test
should rely on them.

## Guards, and how to read a failure

| Guard | Where | What a failure says |
|---|---|---|
| Layout ratchet | `apps/desktop/test/layout-ratchet.test.ts` | `src/ui/X.tsx: 12 > 11`: the screen gained a raw layout utility. Use a primitive or a named style. |
| Style lint | `scripts/lib/style-lint.ts` | A palette colour or a fixed measure in `style`. |
| One definition per named style | `apps/desktop/test/css-utilities.test.ts` | The names defined twice. |
| Contrast | `scripts/test/theme-contrast.test.ts` | The token pair and theme under its ratio. Also any field that draws a border without `border-input`. |
| Test anchors | `apps/desktop/test/test-anchors.test.tsx` | A `data-testid` with no `testid:` comment, or more of them than `testid-baseline.json` allows. |
| axe | `bun run demo:shots` | Serious and critical violations, `target-size` included, per print. |
| Layout guards | `scripts/lib/layout-guards.ts` (#192), in the e2e journeys | Each finding is a rule, a `data-slot` path and a detail, judged against a baseline that only goes down. |
| e2e layout checks | `scripts/e2e/journeys.ts`, `layout()` | Sideways scroll, the end of a list, the summary over the conversation, a split area's tab bar taller than 40 px, the waiting session not at its end, a Needs you line wider than its row. |
| Prints | `bun run demo:shots` | Both themes and both languages, under `apps/desktop/screenshots/`. Read them; they show what the guards cannot. |
