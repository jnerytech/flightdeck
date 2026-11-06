# Keycaps, tooltips, loading and back-out buttons: the one-pass audit (issue #165)

The component and the cheap fixes are in; the rest are findings with a follow-up. `docs/DESIGN.md` (issue #193) writes the rules down.

**Keycap.** `components/shortcuts/keycap.tsx` has `Keycap` (the one `<kbd>`) and `ShortcutKeys` (a binding written for the platform:
`Ctrl`, or `⌘` on a Mac). The text comes from `keysText` in `lib/shortcuts.ts`, which the sheet's `keysLabel` now calls. The `?` sheet,
the palette, the Start screen and the sidebar's search item use it, and a test fails if any file under `src/ui` or `src/components`
(the vendored `components/ui` aside) draws a `<kbd>` of its own. One visible change: the sidebar's search chip read `Ctrl K` in a
different frame; it now reads `Ctrl+K` like the rest. The Start screen's four keys were literal `Ctrl+…` text; they are bindings now, so
a Mac sees `⌘`.

| Finding | Where | Fixed or filed |
| --- | --- | --- |
| Native `title` naming an icon-only control | the narrow sidebar's items (`NavButton`) | Fixed: `IconTip` (400 ms, top, 4 px) |
| Native `title` naming an icon-only control | the client switcher in the rail | Fixed: `IconTip`, and only in the rail (the expanded one has its name in view) |
| Native `title` naming an icon-only control | `StatusDot` | Filed: #146 replaces the dot with a glyph and a real tooltip |
| Native `title` carrying a hint | `HoldButton` ("hold to say yes") | Follow-up: the hint is text a person needs, so a tooltip is wrong too; it should be visible text |
| Native `title` carrying a hint | tile layout options (`session-tiles`), breadcrumb steps, the day chart's bars, truncated names | Fixed in issue #239 (below) |
| Back-out button drawn destructive | none found: every `variant="destructive"` is the irreversible action (Discard, Remove host, Rewind, Deny, Close terminal) | Nothing to fix |
| In-flight feedback with no duration rule | `Spinner` in `ActionButton`/`busy.tsx`, the activity line, the status line, simple mode's task view | Follow-up: screens defer by `useMinLoading` (150 ms floor), buttons show the spinner at once; the rule (nothing under 100 ms, disabled to 1 s, spinner to 3 s, stages after) needs one hook |

Not done here, on purpose: a lint for `title=` on icon-only buttons (the issue's optional item 4). The audit found about 125 `title=` uses,
most of them page and panel titles that are a different prop; telling an icon-only button's from the rest needs the layout ratchet's
pattern, and is worth its own issue.
