# Tabs and embedded terminal

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/tabs-and-embedded-terminal.md)

## Tabs

Every screen opens in a tab, as in a browser. Each tab keeps its own back and forward history.

- **Tabs per host:** each host keeps its own tabs. Picking a host in the top bar swaps the row to
  that host's tabs and goes back to the tab it had open (a host with no tab opens its Overview).
  Opening a screen of another host (a search result, a notification, a link) switches to that host.
  The screens that belong to no host (Home, Sessions, Needs you, Projects of all hosts, Settings and
  the like) sit at the left of every row as pinned tabs with an icon only, and the top bar keeps
  showing the last host used while one of them is open. `Ctrl+Tab` goes over the shared tabs and
  then the current host's.

- **Tab titles and names:** a host's tab does not repeat the host's name in its title: its Overview
  tab says **Overview** and its History tab says **History**. A screen reader still hears the host:
  each of the host's tabs is named like "Board, host alfa", and picking a host says "alfa: 5 tabs"
  once, politely.

- **Narrow windows:** under 640 px wide the row is one button, not a strip to scroll. It shows the
  current tab (its icon, its title and its host's dot) and how many tabs are open; it opens the list of
  all tabs across the width of the window, where a tap goes to a tab. **+** still opens a new tab; the
  split buttons are not offered. A screen reader hears it as "All tabs (5), current: Board, host alfa".

- **Tabs of all hosts:** the host switcher has an entry, **Tabs of all hosts**, for people who work
  across hosts at once. Checked, the row lists every host's tabs after the shared ones, in a group
  headed by the host's name and dot, each tab in its host's color. A tab of another host switches to
  that host when you pick it, and the switcher follows. Unchecked, the row is the current host's
  again. The choice is kept. The entry appears with two hosts or more.

- **Host colors:** each host has one of eight colors, the same wherever the host shows. It is a dot
  next to the host's name in the top bar's switcher and in the list of all tabs, and a 2 px line over
  the top of each of the host's tabs. The color is never the only sign: the host's name stands beside
  every dot, and the colors keep 3:1 against the surfaces in the light and the dark theme.

- **Opening:** a normal click changes the current tab. `Ctrl+click`, the middle mouse button or
  **Open in new tab** (in the host's menu and in a session row's menu) opens a new one. The **+**
  button at the end of the bar opens a new tab on the `Ctrl+K` palette. A screen has one tab: a
  link to a screen another tab already shows (a breadcrumb, a page link, reopening a running
  terminal) goes to that tab instead of opening a second one.
- **All tabs:** past eight tabs, the chevron at the end of the bar opens a list of all of them:
  each row has the tab's icon, its title on one line (the whole title in its tooltip), its host,
  and a close button on hover. The tab on screen has a bar at its left. Type to filter; the arrows,
  `Home` and `End` move the highlight, `Enter` goes to the tab and `Delete` closes it. `Esc` or a
  click outside closes the list.
- **The bar:** each tab shows its type's icon and title, and a badge when a session in it needs
  you, is running, or answered while no tab showed it (**Unread**). **Pin** keeps the tab at the
  left with its icon only. The pin, move and close buttons after the tabs act on the active one;
  the middle button closes any tab. Drag a tab onto another to reorder it. While dragging, a bar marks where the tab will land. The order is kept between sessions.
- **Shortcuts:**

  | Shortcut | Action |
  | --- | --- |
  | `Ctrl+T` | new tab, on the palette |
  | `Ctrl+W` | close the tab |
  | `Ctrl+Shift+T` | reopen the last closed tab (the last 20 are kept) |
  | `Ctrl+Tab` (hold `Ctrl`, press `Tab` again to go down) / `Ctrl+Shift+Tab` (up) | opens the switcher on the most recently used tabs of the focused area, on the previous one; release `Ctrl` to go to the one selected, `Esc` or leaving the window to cancel. A quick tap goes to the previous tab, and another tap comes back |
  | `Ctrl+1`…`Ctrl+9` | go to that tab (`Ctrl+9` is the last one) |
  | `Ctrl+Shift+PageUp` / `PageDown` | move the active tab left or right |
  | `Ctrl+Shift+←` / `→` (on a focused tab) | move that tab left or right; a screen reader is told its new place |
  | `Ctrl+\` | split the window or join the areas |

  Settings, Appearance, **Ctrl+Tab order** chooses **Most recently used** (the default) or
  **Tab order**, where `Ctrl+Tab` and `Ctrl+Shift+Tab` step to the next and previous tab as before.
  The switcher is a list for screen readers (the selected tab is announced); the list is not kept
  between starts.

  In the demo's web entry, Chromium keeps `Ctrl+T`, `Ctrl+W`, `Ctrl+Shift+T` and `Ctrl+Tab` for
  itself: use the buttons there.
- **Kept between starts:** the tabs, which ones are pinned, the active tab, the split and the
  divider come back when the app opens again. Each tab comes back on its screen, without its
  history. The host form is never kept, since it can hold a token. A tab of a host that is not
  connected yet shows **Connecting to <host>…** until it is.

## Split view

`Ctrl+\` or **Split the screen** (at the end of the first tab bar) divides the window in two
areas, side by side; **Split horizontally** stacks them instead, and **Join the areas** puts every
tab back in one. Each area has its own tab bar.

- The new area starts on the screen of the active tab.
- A click in an area makes it the focused one: what you open from the sidebar, the palette or a
  link goes there.
- Drag the divider, or focus it and use the arrows, to give an area between 20% and 80% of the
  window.
- **Move tab to the other area** sends a tab across; an area left empty closes.

## Embedded terminal

A daemon from version 0.14 opens real terminals (a PTY) on its host, and the app shows them in a
tab, with no SSH.

- **On or off:** a terminal is a full shell on the host, as the daemon's user. It is on by itself
  only when the daemon listens on loopback; with `bind` open to other networks it is off. The
  host page's **Terminal** panel turns it on (it asks first) or off (which ends the open
  terminals); the daemon writes the choice to `terminal.enabled` in its config.
- **Opening:** **New terminal** on the host page, or **New terminal on <host>** in the palette,
  opens the host's default shell (`pwsh` or `powershell` on Windows; `$SHELL`, `bash` or `sh` on
  Linux) in its first allowed folder. The panel also lists the live terminals, each with
  **Open**.
- **In the tab:** copy and paste with `Ctrl+Shift+C` / `Ctrl+Shift+V` or the right button's
  menu (**Copy**, which needs a selection, **Paste** and **Select all**). On Windows `Ctrl+C`
  also copies while something is selected, and goes to the process (the interrupt) when nothing is;
  elsewhere `Ctrl+C` always goes to the process. A program that redraws its screen (Claude Code)
  can drop a selection before you reach **Copy**: the last selection stays copyable until you
  type. When the program takes the mouse for itself, hold `Shift` while you drag to select.
  `Shift+Enter` adds a new line in a Claude Code prompt instead of sending it (the same as
  `Alt+Enter`). If grey blocks of an old screen stay behind in Claude Code's side panel, that is
  Claude Code leaving cells uncleared (the same happens in other terminals): `Ctrl+L` or resizing
  the pane makes it repaint. Pasting several lines into a program that has not asked for pasted
  text to be marked (bracketed paste; a plain shell prompt, for example) asks first, since each line
  could run as a command as it lands; Cancel has the focus. Claude Code asks for the marking, so a
  paste into it goes straight in. Search with `Ctrl+Shift+F`: matches are highlighted as you type, with the current one
  in another color and its position ("2 of 5") beside the box; Enter or **Next match** goes to
  the next one, Shift+Enter or **Previous match** to the previous, Esc or **Close search**
  closes. Beside the box, **Match case** (`Alt+C`), **Match whole word** (`Alt+W`) and **Use
  regular expression** (`Alt+R`) narrow the search; an expression that does not read, or one that
  matches empty text, says so instead of searching. Links in the output open in the browser (`http`
  and `https` only). File paths in the output are links too: absolute ones (`C:\repo\a.md`,
  `/home/ana/x.log`) and relative ones with a folder and an extension (`src/app.ts:12`), taken from
  the terminal's folder. A file inside the terminal's folder opens under the terminal in the Files
  viewer, read-only, at the line the path names (`src/app.ts:12` opens at line 12); **Close** puts
  it away. A path outside that folder, or on a host whose daemon is too old to read it, is shown in its folder on a
  host of this computer (never opened or run) and copied on another host. The font is the
  system monospace; its size is in Settings (**Terminal font size**, 10 to 24). In the tab,
  `Ctrl+=` (or `Ctrl++`) and `Ctrl+-`, or `Ctrl` with the mouse wheel, make it one point bigger or
  smaller, and `Ctrl+0` brings back 13; the size is the same setting and is kept. For a screen
  reader (NVDA, Narrator), turn on **Screen reader support in the terminal** in Settings: the
  terminal then keeps a copy of its output the reader can follow (long output draws more slowly, so
  it starts off). The tab keeps
  the last 10,000 lines to scroll back to and to search.
- **Detach and reopen:** a terminal survives the app: it keeps the last 2 MB of output, and
  attaching again shows them. Closing a terminal tab asks: **Detach** (the default; the process
  keeps running on the host) or **End process**. A terminal shown as detached or ended has
  **Reopen**.
- **Limits:** 10 live terminals per host (`terminal.max`), and a terminal nobody is attached to is
  ended after 120 minutes (`terminal.idleMinutes`). Terminals do not survive a restart or an
  update of the daemon. Their content never goes to the log or to the database.
- **Scrolling Claude Code:** in Claude Code's fullscreen mode the wheel goes to Claude Code, which
  moves by its own `CLAUDE_CODE_SCROLL_SPEED`. Terminals opened by the app set it to 3 lines a
  notch, as Windows Terminal and VS Code feel, unless the host's environment or Claude Code's
  settings (where `/scroll-speed` keeps it) already set a speed: then that one is used.

## Claude here

When the host's terminals are on, every **Open in terminal** button (session, card, project,
checkpoint) gets a companion:

- **Open Claude here (terminal)** opens `flightdeckd claude` in the folder (the card's worktree
  for a card) in a terminal tab. The session is born in the central, controllable: you approve
  and send messages from the app while you watch the terminal.
- **Continue in the terminal** resumes a session with `flightdeckd claude --resume <id>`; ended
  terminal sessions and history sessions have it in the reader.
- The terminal tab of such a session has **View as session**, and the session has **View
  terminal**: both are the same Claude, tied by the launch id.

The outside terminal ([Open in terminal](daily-use.md#open-in-terminal)) stays next to them.

When the session is already live in another terminal (VS Code's, say), **Continue in the terminal**
and the outside terminal ask first: a second `claude` on the same session would not be seen by the
first one. Each shows only its own turns, and both write to the same history. **View it live here**
(the default) opens the session's live view, which follows that terminal's transcript; **Open a
second copy anyway** opens it here all the same.
