# Projects

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/projects.md)

The **Projects** item of the sidebar (between Needs you and Board) lists the projects of the host
chosen in the top bar's switcher (every host's with **Tabs of all hosts**) as cards, so opening
one never lands on another host: its name, host, base branch, the live sessions, the cards in progress, the ones
that need you, the last activity and what it cost over the last seven days. The cost is a dash
when the host does not report costs. Type in the search box to narrow the list by name, host,
branch or folder, and use **Sort by** to order it by last activity, name, cost this week or what
needs attention first.

**New project**, at the top right of the page, adds a project: it opens the add form (the folders of
recent sessions, a typed or browsed folder, **Add**) and the project's page opens once it is added.
With one host online, or with a host filter on, the form is for that host; with several hosts
online it first asks which one ("On alfa", "On beta"). With no host online the button is off and
says so.

Click a card to open the project's page. It links the project's **Board**, **Sessions**,
**Workflows**, **Costs** (when the host reports costs) and **Settings** (the host's project
settings, where the folder, base branch, setup and personas are edited).

## Moving a session to another host (preview)

An idle session can continue on another host: its conversation, its commits and its uncommitted changes go with it. It is a preview, off by default: turn it on in Settings, Window, "Preview: move a session to another host".

1. In the session's menu (the "…" on its row), pick **Move to another host…**.
2. Pick the host and the repository there: press **Browse…** to choose among the folders that host allows, or type the path. It must be the same project, so that host must already have a clone of it.
   If either host is reached over plain `ws://` and is not this machine, a warning names it: the conversation and the code then travel through the app unencrypted, so move only over a network you trust.
3. Read what moves: the branch, the commits not on origin yet, the files changed, the size, and how many lines look like secrets. The secrets themselves are never shown, and they move as they are.
4. Press **Move**, then **Open it there**. Once every byte is sent you can close the window: when the move ends, a toast says so, with **Open it there**, or says why it was refused.

On the other host the code is in a new worktree of that repository, on a branch of its own, and the session goes on from where it stopped. The session here is archived, with its conversation kept: it lives on the other host now. You can move it back later: this host takes it when the copy it kept has nothing the moved session lacks and is not in use, and sets that copy aside as `<id>.jsonl.replaced-<date>` next to it, never deleting it. If you went on with the copy here after the move, the move back is refused: open the one here instead. Files kept in Git LFS arrive as pointers: run `git lfs pull` in the worktree to fetch them. Symbolic links in the code arrive as links, as in any clone of someone else's repository: a write through one can land outside the worktree, so move sessions only between hosts you trust.

## Sleeping idle sessions

An idle session keeps its Claude Code process, and its memory, until it ends. On the host page,
**Sleep idle sessions after** (Off, 15 minutes, 30 minutes, 1 hour or 4 hours; off by default, and
`sessions.sleepAfterMinutes` in the daemon config) lets the host end the process of a session that
has been idle that long. The session stays in every list as **Asleep** (a moon) and keeps its
transcript, name and place; the next message starts it again from where it was, with no visible
loss. Only a session with nothing going on sleeps: not one that is working or waiting for you, not
one with a queued message, not one open in a tab or watched by the app, not a pinned one and not a
card's. **Sleep now** in a session's menu does it at once for an idle session (it still refuses a
pinned or card session). Every sleep is logged in the session's events. While the setting is off the
daemon runs no timer for it, and a daemon restart leaves idle sessions asleep in the same way.

## Sessions side by side

When the project has sessions that Flightdeck started, the page shows them as **tiles**. The
**Layout** control above them is a row of icons that draw the grid: 2 side by side, 3 columns, a
2×2 grid, a 2×3 grid, and **Auto** (the default), which shows every live session. Hover an icon for
its name; the choice is kept. When the layout holds fewer tiles than there are live sessions, the
page says how many are left out ("+2 not shown"). The sessions that need you come
first, then the running ones, then the idle ones. Each tile has the session's name (a button that
opens it), its status, its **last lines**, the **request** it is waiting on (with **Allow** and
**Deny**) and a small message box: **Enter** sends, **Ctrl+Enter** adds a new line, and the send
icon shows when there is text. From the keyboard, Tab reaches each tile, and **Alt+arrow keys**
move between them (left and right by one, up and down by a row). The tiles follow their sessions
live; the list is the project's, so a session of another project never shows here.

## The sidebar, the tab strip and Settings

- The sidebar groups its items by purpose, in five folding groups: **Work** (Home, Sessions, Needs you,
  Projects, Board), **Automation** (Workflows, Teams, Conversations), **Observability** (Costs,
  History), **Library** (Personas, Snippets, Plugins, Vault) and **Machines** (the hosts, each with
  its state dot, health mark and menu, a **+** to add one, then **SSH**, the saved SSH destinations).
  The open page has a filled row and a bar at its left edge, items with sub-pages end in a chevron,
  recent features carry a **Beta** or **New** badge that goes away by itself from the version the
  badge was set to end at (Teams' Beta ends at 0.39, Conversations' New at 0.38). A group with nothing to offer is not drawn, the
  folded groups are remembered (a folded **Machines** shows a warning mark on its title while a machine
  is offline, misses a required dependency or forwards its API key), and the narrow icon rail has no headings.
- Under **Projects**, each project of the switcher's host (every online host's with **Tabs of all
  hosts**) lists its **branches**: the main checkout
  (badge **primary**, the base branch) and one line per card that has a worktree, each with a state
  dot, the branch and the base below it. Picking one narrows the board and the Sessions list to
  that checkout (a chip with the branch clears it); picking it again clears it too. Picked from the Sessions list, it narrows the list in place and does not open the board; from anywhere else it opens the project's board. A pick whose branch, project or host is gone does nothing and shows no chip. The tree comes
  from what the app already has, with no host change. A project with many worktrees lists the first
  8 and a button **N more** (and **Show fewer**) for the rest; the picked branch is always listed.
  The project's name folds its branches (the arrow keys left and right fold and unfold it); the fold
  is remembered on this computer, and a folded project that holds the picked branch shows a check
  on its name.
  In the narrow icon rail, which has no room for the tree, the **Projects** icon opens it in a panel
  beside the rail (the same tree, with **All projects (N)** always at its end): picking a branch or
  that link closes the panel, Esc or pressing the icon again closes it too, and the focus goes back
  to the icon. With no project to list, the icon opens the Projects page as before.
  The tree lists at most 5 projects: the ones you **pinned** (the pin on a project's row), then the
  most recently active, and always the project of the picked branch. Below them, **All projects (N)**
  opens the Projects page. With more than 5 projects a **Filter projects** field narrows the list by
  name to every match (Esc clears it). With more than 3 projects, all but the active one start
  folded; what you fold or unfold is remembered, and a folded project with a running session or one
  that needs you shows a dot on its name. Pins are kept on this computer.
- At the foot of the bar, **Settings** is a visible item (marked while Settings is open), and the Claude
  account (its email and plan, read from the host's account card; the rail shows only its initial)
  opens a menu. Its header names the app and its version. Then come the plan, the account and the id
  of the host whose account it is, each copied when chosen; **Compact rows**, a switch kept on this
  computer (the same density as in Settings); three more switches kept on this computer, **Hide New
  and Beta badges** (the small badges on the sidebar's recent items), **Hide What's new** (the dot and
  the item below) and **Hide the setup checklist** (the same as the hide button on its row; **Show the
  setup checklist** in Settings brings it back); **Settings**; **What's new** (the highlights of the latest
  releases, read from GitHub through a host that can; the account row and this item carry a dot, and
  the row's name says so, after the app was updated, until you open it; full-screen in a narrow
  window; **View all releases** opens GitHub); **Check for updates** (it opens Settings,
  where the answer shows); **Keyboard shortcuts**; **Toggle theme**; **Manual**; and, for each host
  whose `gh` is signed in to GitHub with a login the app can remove, **Sign out of GitHub** (after a
  confirmation; a login that comes from the daemon's environment is removed there). With several hosts the account of the
  open host is shown, and how many accounts there are when they differ; an offline host shows none.
- **Home** (first in Work) is a strip of four cards over the last seven days of every online host,
  each with a sparkline: **Spend** (with the month's host budgets, when set), **Turns** (ok and
  failed), **Tokens** (with what came from the cache) and the **average turn** (cost, time and
  success rate). Spend, Tokens and the average open Costs on the same seven days (across all hosts when
  several have costs); Turns opens the History of the host, on the same days, when there is one
  online host, and Costs across all of them when there are several (History is one host's). A host
  that does not have costs shows "—" for Spend and Tokens, not $0, and the card names it; the
  average cost counts managed sessions only, unlike Spend, which reads every transcript, and its
  card says so. While the hosts are still connecting at start, Home says "Connecting to your
  hosts…" in a live region, and "Home is ready." is announced when the numbers arrive. The failed turns and the turn time are counted by the daemon from this version on: a
  host on an older daemon shows "—" instead of a made-up zero, and days before the update are
  unknown (the average time and the success rate use only the turns that were counted). Home reads
  again every minute and when the window gets focus; a host that does not answer is named under
  the title and the others still count. Home keeps the last numbers of each set of hosts, in memory
  and in the app's local storage (only numbers and the time they were read, no project or title),
  and shows them at once with an "Updated … ago" line while it reads again in the background; a
  host that does not answer keeps its last numbers, and the page says so. The desktop app opens on Home when the window is new; a
  window you already used comes back with its tabs. The account at the foot of the bar is the one
  of the host you are on; with no host open it is the shared account of the online hosts, or "N
  accounts" when they differ.
- **Data from** (#126): with two hosts or more, Home's toolbar has a menu that says whose numbers
  it shows, **All hosts**, one host, or one project from its **Projects** group (that project on
  every host, named in the subtitle), and changes them; the choice is kept across starts, and a
  change is announced ("Showing alfa"). It is not the host switcher at the top, which is about tabs.
  When the chosen host is offline, Home says so and offers **Show all hosts**; a host whose daemon
  needs an update says that instead, and the menu does not offer it. Costs follows it too
  (see **Costs and budgets**), and so does Sessions (the hub's own host filter, if you had one,
  becomes the choice once); the Board follows it in a later version.
- The tabs have a row of their own under the top bar, over each area (with a split, each area has
  its own). They are flat, as in VS Code: thin lines part them, each is as wide as its title (then
  the title is cut and its tooltip has it whole), the inactive ones are dimmer, and the active one
  has the screen's background with an accent line on top. In a window under 600 px tall the one
  area's tabs share the top bar's row instead, so a small window keeps room for the conversation.
  The strip keeps three tools: the active tab's **Actions** menu (move left or right, move to the
  other area, pin), **New tab** and **Split**.
- The path in the top bar names every step in a window 1024 px wide or more. From 640 to 1023 px
  it shows only the step you are on (the whole path is in its tooltip and read by a screen reader);
  under 640 px it is not drawn, because the page's own header carries the title.
- The host switcher in the top bar shows the host's name in a window 1024 px wide or more. Under
  1024 px it shows the host's color dot and the first letter of its name (a screen reader still
  reads the full name). Under 640 px **Back** and **Forward** leave the top bar and sit at the top
  of the sidebar's drawer, which a navigation closes.
- While a request waits for you in a session, the session's header, the not-trusted notice and the
  summary each take one line, so the request is whole on screen; **More actions** and the summary's
  own button open the rest.
- **Settings** has a rail of its sections (it takes you to a section and puts the focus there) and
  a search box: typing keeps the sections whose name or settings match.
- **Costs** shows four tiles above the charts: the estimated cost, the tokens, the cache savings and
  the top model with what it cost.
- **While you were away** (at the top of **Needs you**) summarises what happened on your hosts since
  the app was last active, when that was at least 30 minutes ago: per host, the sessions that
  finished, the cards that reached review, the PRs merged or with failing checks, the failed
  workflow runs and the quota used. Each line goes to the session or the card; a group shows its
  first three lines and says how many more there are. A host that did not answer is named. It
  shows only when something is new, and **Dismiss** closes it until the next start (the focus moves to the first item of the list, or
  to the page title when there is none).
- **Pull requests** (in the sidebar under Work, after Board; or **Go to Pull requests** in the
  palette) lists every card with an open PR on the connected hosts, the ones that need a look first
  (failing checks, a conflict, changes requested, or a watch that needs you). A row names the card, its host and project, its
  checks, whether **Watch and fix** is off, watching or needs you, and a link to the PR. **Merge
  PR** asks first, with the same confirm as the card page, and is offered only when the host can
  merge and the checks are not failing; **Update from the base** rebases the card's branch, and a
  conflict stays on screen with the files. With two or more PRs that can take it (a branch, and not
  running), **Update N from the base** above the list updates them all, one at a time, each on its
  own host, as the board's selection bar does: a PR already on its base is left alone, a conflict
  stops only that card, and a line names the updated, already current and conflicted cards. Under the button, a line names the listed PRs it leaves out and why (no
  branch on its host, or running). The title opens the card. A line under the title says
  its review (approved, changes requested, review required) and how long it has been open, as the
  host's PR poll reports them (about every minute); a host that does not report them, or has not
  polled yet, adds nothing. A PR that conflicts with its base has no **Merge PR** (GitHub would
  refuse it): the conflict is a badge by the checks, **Update from the base** leads, and a card with
  no worktree here says to bring the branch up to date. A PR that is blocked by the branch rules, or
  waits for a review or for changes, keeps **Merge PR** as a secondary button and says why GitHub
  may refuse it.
- **Activity** (in the sidebar after Costs; `g a`, or **Go to Activity** in the palette) shows every
  live session of every host in four columns: **Needs you** (the session is asking), **Working**,
  **Done** (a turn ended in the last 2 hours and you have not opened the session) and **Idle**,
  which stays hidden until you tick **Show idle sessions** (the choice is kept). A card says the
  session, its project, host and persona, the last request and how long ago it changed; the newest
  change is first. A card that is asking shows the request with **Approve** and **Deny** (a
  high-risk one is approved by holding the button; a question for you only opens the session). A
  click opens the session; Ctrl-click or the middle button opens it in a new tab. Search and the
  Host, Project and Persona lists narrow the cards, and the count reads "n of m shown". When a
  session changes state its card glides to the other column (not with reduced motion). The board
  scrolls inside itself. Simple mode does not have this screen.
