# The sidebar scrolls as one area, and the app has one scrollbar style (issue #567)

## Context

On Windows the sidebar showed two native scrollbars, arrows included, side by side in a 240 px column: one for the nav groups and one for the machines. #171 had made the nav shrink and scroll on its own, so the hosts section always kept its room. The shell's `<aside>` could scroll as a third area, and the pinned list as a fourth. The rest of the app (the search popover, Settings) showed the same native arrow bars.

## Decision

- The sidebar has one scrolling body (`sidebar-body`: the nav groups, the machines and the pinned sessions). It sits between a fixed header (the logo and the workspace switcher) and a fixed footer (`sidebar-foot`: Search, Settings, the account). The shell's aside now clips (`overflow-hidden`) instead of scrolling. The body's children never shrink, so the 24 px targets of #232 hold. The hosts section keeps its `min-height: 7rem` (#171), and it scrolls with the nav rather than against it.
- One scrollbar style for the whole app, in `@layer base`. WebView2 gets `::-webkit-scrollbar` rules: 8 px, no arrow buttons, a transparent track, and a `--scrollbar-thumb` thumb that shows on hover. Other engines get `scrollbar-width: thin` and `scrollbar-color`, but only inside `@supports not selector(::-webkit-scrollbar)`. Chromium 121+ ignores the webkit rules on an element once either standard property is set, and on Windows it then draws the native bar with its arrows again. The tab strip's `scrollbar-width: none` is the only standard property outside that block.
- `--scrollbar-thumb` is a token in both themes, with 3:1 against the background, the sidebar and the popover (WCAG 1.4.11).
- The guard: a new contract rule, `scroll-split`, in `layoutFindings`. A region named in `single` (`SINGLE_SCROLL`: `sidebar`) holds at most one element whose computed `overflow-y` is `auto` or `scroll`. The journeys run it at 1280x800 and 1280x600 (`SCROLL_SIZES`), in both languages.

## Discarded alternatives

- **Standard properties for everyone, webkit rules as a fallback.** This was the issue's literal wording, but in WebView2 the standard properties win, and Windows keeps the arrow buttons. The goal of the issue is no arrows.
- **Keeping two areas, with thin scrollbars only.** That fixes the look but not the layout: two bars side by side in a narrow column still read as broken, and the issue asks for one area.
- **Radix ScrollArea in the sidebar.** It is a custom-drawn overlay bar with no native scrolling quirks, but it adds JavaScript, a vendored component and a second scroll model for one region. The CSS rules fix every scroll area at once.

## Consequences

- With the thumb shown only on hover, keyboard-only scrolling shows no thumb. The content still scrolls, and focus moves into view.
- A new scroller inside the sidebar fails the journeys at once (a contract, with no baseline), so a later panel cannot split the sidebar again unnoticed.
