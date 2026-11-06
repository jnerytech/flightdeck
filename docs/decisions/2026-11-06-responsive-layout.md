# Responsive layout: breakpoints, one scroll container per screen, tabs per host (issue #641)

The user found the layout broken in a small window: tabs shrink to "w...", tables spill out of
their cards, the Host page shows two scrollbars and its title slides under the tab row (#640).
They asked for an app that works from a small window up, mobile-first. A second request (#644)
changes how tabs relate to hosts; it is part of the same shell, so it is specified here too.

This file is the spec fd-frontend builds the shell from, and the contract fd-harness's
narrow-size prints and guards check.

## What the app does today (measured in the demo, 2026-11-06)

- The window opens at 1200 x 800 and cannot be made narrower than 720 x 480
  (`src-tauri/tauri.conf.json`).
- The shell is one grid (`components/layout/app-shell.tsx`): a 48 px top bar, then a sidebar
  and the main area, then a status bar.
  - The sidebar is 240 px wide.
  - Below 960 px (`NARROW_QUERY`) it starts as a 56 px icon rail. Its toggle is not remembered.
- The tab row keeps each tab between 6 rem and 13 rem wide and scrolls sideways. After 8 tabs it
  offers the list of all tabs (#576).
- Each page (`Page`) has one ScrollArea for its body. The page header sits above the ScrollArea,
  outside it.
- Around every screen, the area wrapper (`ui/Areas.tsx`, `@container min-h-0 flex-1
  overflow-y-auto`) can scroll too. It is there for screens that are not a `Page`.
- On the Host page the wrapper scrolls (2511 px of content in a 592 px box at 1024 x 700), and
  inside it the page's own ScrollArea scrolls too. This happens at 1024, 640 and 390 px. It is
  the "two scrollbars" of #640.
  - The cause is a table's `sr-only` `<caption>`, which is absolutely positioned.
  - The ScrollArea's viewport is not positioned, so the caption is placed against an ancestor
    outside it, at its spot 2595 px down the content.
  - The viewport does not clip it, so it stretches the wrapper.
  - Any absolutely positioned element in a long page does the same.
- Because the wrapper holds the page header, scrolling it slides the title under the tab row.
  This is the cut title of #640.
- At 390 px:
  - the sidebar rail still takes 56 px;
  - the breadcrumb is cut to "Sess";
  - the status bar's items overlap ("42% 2h 59m" runs into "Keep awake");
  - session titles are cut to four letters.
- Breakpoints are scattered:
  - one 960 px media query in JS;
  - ten `max-width: 959px` and one `max-width: 640px` rules in `styles.css`;
  - a few `sm:`, `md:` and `lg:` utilities;
  - `@3xl:` container queries in `stack.tsx`, `two-pane.tsx` and `CostsPage.tsx`.

## What other desktop apps do in a narrow window

Only Teams publishes its behavior; for the others I found no documentation of a width
breakpoint, so the notes below say where they come from.

- **Microsoft Teams** (2025):
  - The main window can shrink to 360 px wide, down from 720 px, with every menu still reachable
    ([MC947051](https://mc.merill.net/message/MC947051),
    [Microsoft 365 for IT Pros](https://office365itpros.com/2024/12/16/resizable-teams-windows/amp/)).
  - At the smallest size, the app bar moves behind a hamburger menu at the top left.
  - Side panels keep a width the user can drag.
- **Slack** documents no width breakpoint. Its help pages say:
  - the workspace switcher can sit beside the sidebar or fold into one icon on the navigation bar;
  - the user drags the sidebar's edge to resize it
    ([Slack help](https://slack.com/help/articles/212596808),
    [TidBITS](https://tidbits.com/2023/09/21/how-to-restore-the-slack-workspace-sidebar/)).
  - Each workspace keeps its own channels, history and position. This is the model #644 adopts
    for hosts.
- **VS Code** documents no automatic collapse. In use:
  - the activity bar stays an icon rail;
  - the side bar keeps a minimum width, and the user hides it;
  - editor tabs scroll sideways, with a list of open editors for the rest.
  - Third-party reports show the usual failure: content sized against the window instead of its
    pane, so controls are clipped when the pane is narrow
    ([continuedev/continue#13219](https://github.com/continuedev/continue/issues/13219)).
- **Linear** publishes nothing on this. Design systems with the same pattern collapse the sidebar
  below a fixed width and show it as an overlay that does not remember its state
  ([Anvil sidebar](https://anvil.servicetitan.com/components/sidebar/)).

Taken together:
- an icon rail at medium width;
- a drawer behind a menu button at the smallest width;
- tabs that scroll, plus a list of all tabs;
- panes sized by their own width, not the window's;
- a workspace (here, a host) that keeps its own tabs and state.

## Decisions

### 1. Window size

- The minimum window becomes **360 x 480**. This is the Teams floor, and fits a phone-width
  window docked beside an editor.
- The default stays 1200 x 800.

### 2. Three breakpoints, mobile-first, by window width

| Name | Window width | Tailwind |
| --- | --- | --- |
| compact | below 640 px | no prefix (the base styles) |
| medium | 640 to 1023 px | `sm:` |
| wide | 1024 px and up | `lg:` |

- Styles are written for compact first, then widened with `sm:` and `lg:`. `md:` and `xl:` are
  not used for the shell.
- The JS check (`NARROW_QUERY`, today 959 px) becomes one hook, `useBreakpoint()`. It returns
  `"compact" | "medium" | "wide"` and is built on `matchMedia("(width < 640px)")` and
  `matchMedia("(width < 1024px)")`.
- The 959 px rules in `styles.css` move to these two widths.
- A component that cares about its own width uses a container query: `@container` with Tailwind's
  `@sm:`, `@md:` or `@lg:`, never the window's width. This covers cards, tables, split panes and
  forms. A table inside a 400 px pane is narrow even in a wide window.

### 3. Each region at each size

**Top bar (48 px)**
- Wide:
  - the sidebar toggle;
  - the host switcher with the host's color dot and name;
  - back and forward;
  - the full breadcrumb;
  - the search field;
  - the theme and notifications buttons.
- Medium:
  - the switcher shows the dot and the host's initial; the name stays its accessible name;
  - the breadcrumb shows only its last crumb;
  - search becomes an icon button that opens the palette.
- Compact:
  - a menu button opens the sidebar drawer;
  - the switcher, as in medium;
  - search is an icon;
  - no breadcrumb, since the page header carries the title;
  - back and forward move into the drawer.
- Every control keeps an accessible name and a visible focus ring. Nothing is hidden by `display`
  alone without a reachable equivalent.

**Sidebar**
- Wide:
  - 240 px, pushing the content;
  - the toggle folds it to the 56 px rail;
  - the choice is remembered (persisted) while the window stays wide.
- Medium:
  - the 56 px rail, with a tooltip on hover and focus for each icon;
  - the toggle opens the full 240 px sidebar as an overlay over the content, not pushing it;
  - it closes on Esc, on a click outside, and after navigating.
- Compact:
  - no rail;
  - the menu button opens the full sidebar as a modal drawer from the left, `min(320px, 85vw)`
    wide;
  - focus is trapped in the drawer, Esc closes it, and focus returns to the menu button;
  - it closes after navigating.
- The drawer and the overlay slide in over 150 ms. With `prefers-reduced-motion: reduce` they
  appear without motion.

**Tab row** (with the per-host sets of section 5)
- Wide and medium:
  - tabs between 6 rem and 13 rem, scrolling sideways;
  - the "all tabs" list button (#576) is always there once the tabs do not fit, not only past 8
    tabs;
  - shared pinned tabs are icon-only at medium.
- Compact:
  - the tab row is replaced by one "current tab" button showing the active tab's icon, title and
    host dot, plus the count of open tabs;
  - it opens the all-tabs list full width, like a phone browser's tab switcher;
  - Ctrl+Tab and the list's keys work as today.
- A tab's title never shows the host's name (section 5). The tab's `title` attribute gives the
  full title.

**Page header** (title, subtitle, actions, toolbar)
- It is outside the page's scroll container. The area wrapper never scrolls (section 4), so the
  title can never slide under the tab row. The structure does this, not `position: sticky`.
- The title wraps to at most two lines, then truncates; the full text is in its `title`.
- Wide and medium: actions sit at the right of the title; the toolbar wraps.
- Compact:
  - actions move under the title;
  - more than two actions fold into a "More" menu, keeping the primary one visible;
  - filters fold behind a "Filters" button that opens a sheet.

**Page body**
- The side gutter is 24 px wide, 16 px at medium and 12 px at compact.
- The vertical rhythm stays the spacing scale of `2026-11-06-spacing-scale.md`.
- Forms and reading pages cap at 48 rem. Dashboards and boards use the full width.

**Cards and grids**
- A grid of cards uses `grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr))`, or a
  container query. Its column count follows its container, not the window.

**Tables**
- The threshold is one theme token, `--container-table: 40rem`, next to `--container-reading`
  in `styles.css`. It gives the `@table:` container variant; the table's frame is the
  `@container`. Write the stacked cards as the base styles and the columns under `@table:`.
- In a container 40 rem (640 px) wide or more, a table keeps its columns:
  - the first column, usually a name, takes the free width and truncates with the full text in
    `title`;
  - numbers are right-aligned and do not wrap.
- In a narrower container, each row becomes a stacked card:
  - the first cell is the card's title;
  - the other cells become "label: value" lines, in the same order;
  - the row's actions sit at the bottom.
- A table never spills out of its card. A table whose meaning needs every column side by side
  (such as the cost table) is marked `wide`:
  - it scrolls sideways inside its own frame;
  - an edge shadow shows there is more;
  - this is the only sideways scroller allowed in a page.
- An empty or unmeasured value shows "—" or "not measured", never a fake zero. This covers #640
  item 5.

**List and detail** (History, Needs you, split views)
- Wide: side by side, as today.
- Medium: the list keeps its container-capped width, already in `split-view.tsx`.
- Compact:
  - one pane at a time;
  - opening an item shows the detail with a back button that returns to the list at the same
    scroll position.

**Dialogs**
- At 640 px and up: centered, `max-w-lg`, as today.
- Compact: a full-screen sheet (`100dvw x 100dvh`):
  - a header with the title and a close button;
  - the body scrolls;
  - the footer buttons stay at the bottom, stacked, primary last.
- Focus handling does not change.

**Popovers and menus**
- They never exceed `calc(100vw - 2rem)` and flip to stay inside the window.
- Compact: the command palette and the tab list take the full width.

**Status bar**
- Wide: every item with its label.
- Medium: icons with their values; the labels go to the tooltip and the accessible name.
- Compact:
  - only the quota bar and the keep-awake button stay;
  - everything else moves into a "…" popover;
  - items never overlap. Today they do at 390 px.

**Hit targets**
- With `pointer: fine`, at least 32 px tall.
- With `pointer: coarse` (a touch screen), at least 44 px.

### 4. One scroll container per screen

- The shell's grid never scrolls.
- A page's scroll viewport is positioned (`relative`), so what is absolutely positioned inside
  it (an `sr-only` caption, a hint) scrolls and clips with it instead of stretching the screen.
- The area wrapper around a screen (`ui/Areas.tsx`) never scrolls either. It becomes a flex
  column (`flex min-h-0 flex-1 flex-col overflow-hidden`) that gives its screen exactly its
  height. A screen that is not a `Page` uses `Page` (or `Page fill`) to get its scroller.
- In each page, the body under the header is the only vertical scroller.
- A nested vertical scroller is allowed only in this list:
  - the sidebar body;
  - each pane of a split view (each pane is its own screen region);
  - a terminal (xterm);
  - a code, diff or log viewer with its own height;
  - a popover's or a dialog's list;
  - the full-screen dialog body.
- Anything else that scrolls inside a page is a defect, and the guard below reports it. On the
  Host page, the inner scroller goes away and the page body is the only one.

### 5. Tabs per host (issue #644)

The user saw the host switcher say "wsl - A" while the open page was "Board of Windows", and a
tab row mixing every host's tabs with no way to tell them apart. The model is Slack's and Teams'
workspaces: each host keeps its own tabs and state.

1. **Each host has its own tab set.**
   - Picking a host in the switcher swaps the tab row to that host's tabs and restores its last
     active tab.
   - A host with no tabs opens its Overview.
2. **Shared tabs** stay at the left of every set, pinned and icon-only at medium and compact:
   - Home;
   - Needs you;
   - Sessions and Projects in "all hosts" scope;
   - Settings.
   They belong to no host.
3. **The switcher always shows the active tab's host.**
   - Opening something of another host (a search result, a notification, a link, a session in a
     cross-host list) switches the host and opens it in that host's set.
   - On a shared tab, the switcher shows the last host used.
4. **Host color.**
   - Each host gets a stable color from its name: a hash into a palette of 8 tokens. Each token
     must keep 3:1 contrast against both themes' backgrounds, and gets a light and a dark value
     in `styles.css`.
   - The color shows as:
     - a dot in the switcher;
     - a 2 px top border on that host's tabs;
     - a dot next to the host's name where a shared page lists hosts.
   - Color is never the only signal: the dot always sits next to the host's name or initial, and
     the tab's accessible name includes the host ("Board, host wsl - A").
5. **"All hosts"** is an optional entry at the end of the switcher.
   - It shows every set in one row, each preceded by a group header (the host's dot and name,
     Chrome tab-group style) that folds its group.
   - It is for people who work on several hosts at once. Picking a host again leaves it.
6. **Tab titles drop the host name.**
   - "Board of flightdeck-web", not "Board of flightdeck-web (wsl - A)". The set already says
     the host.
   - The min width and the all-tabs list (#576) handle the rest.
7. **Persistence.**
   - Each host's set, order and active tab survive a restart.
   - Closing a host's last tab shows that host's Overview.
   - Removing a host drops its set.
8. **Keyboard and screen readers.**
   - Ctrl+Tab and Ctrl+Shift+Tab cycle within the current set, shared tabs included.
   - The switcher's shortcut and its list keys pick a host.
   - Switching hosts announces "wsl - A: 5 tabs" in a polite live region.
   - Each set is one `tablist` named after its host.

## Checks (fd-harness, #641 item 2)

- Prints at 1280 x 800, 1024 x 700, 640 x 800 and 390 x 844, in both themes and languages.
- At each size the guard reports:
  - any sideways overflow of the document;
  - any vertical scroller outside the allowed list of section 4;
  - a page title not fully visible after scrolling its body to the end;
  - status bar items overlapping;
  - text spilling out of its box.
- Its baseline only goes down, like the spacing guard (#628).
- Component tests prove:
  - the breakpoint hook's three answers;
  - the drawer's focus trap and Esc;
  - the per-host tab behavior listed in #644's "done when".

## Order of work

1. fd-frontend builds the shell:
   - the 360 x 480 minimum in `tauri.conf.json`, reviewed by `tauri-rust-reviewer`;
   - the area wrapper that never scrolls (section 4);
   - `useBreakpoint()` and the two media widths;
   - the top bar, sidebar rail and drawer, and status bar of section 3;
   - the compact tab button;
   - the per-host tab sets of section 5.
2. fd-ux-designer fixes the pages the guard flags, worst first. The Host page (#640) is first:
   - one scroller;
   - Health as a summary with problems first;
   - the Resources table as specified above.
   Then Sessions, Home, Projects, Board and Settings.
3. #641 is done when the guard runs in CI at the four sizes and its baseline is zero for Home,
   Sessions, Host, Projects, Board and Settings.
