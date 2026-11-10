# Board

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/board.md)

Each project (a git repository on the host) has a board with five columns: Backlog, In progress,
Needs you, In review and Done. A card becomes a branch `fd/<slug>`, a worktree and a session; the
card moves by itself according to the session and the PR, and it can also be dragged by hand.
Each column has its own tint and a thin line on top (Backlog neutral, In progress amber, Needs you
orange, In review green, Done muted), its status icon, the number of cards as a pill and a **+**
that adds a card straight into that column. An empty column shows a quiet dashed box that says
"Empty" and also adds a card when pressed.

A worktree picked in the sidebar shows its files beside the columns (**Files** hides or shows
them; on a narrow board the files take the columns' place). On a host that searches files, the
panel searches the whole repository: **Names** finds the files whose path holds the text, and
**Content** lists each line that holds it as `path:line`. One search field serves both, so a
pick keeps what you typed. A match opens the file, a content match at its line. A credential, or
a path or line with a token or a vault value in it, shows masked and as **Hidden**, and does not open.

## Working with many cards

- **Select.** `Ctrl`-click (`⌘`-click on a Mac) a card to select it or unselect it; `Shift`-click
  selects the range from the last card you picked, within its column. A card's menu has **Select
  card** too. While a selection exists, every card shows a check that selects or unselects it, and a
  screen reader hears its state and the count.
- **Select from the keyboard** (#1354). On a card, `X` selects it or unselects it, and `Shift` with an
  arrow, `Home` or `End` moves and selects the range from the first card picked, in the board's order.
  While a selection exists, `M` opens the bar's **Move to…** and `S` its **Start N**, never a single card. `Esc` clears
  the selection and leaves the focus on the card; with none, it does what it did before (a split view
  closes). A filter hides cards but keeps them selected; what you do then applies only to the cards
  you can see, and the bar says how many are hidden.
- **The selection bar** above the board shows "3 selected" with **Start N** (the cards that can start),
  **Stop N** (while some of them run or wait in the queue), **Move to…** (a column), **Discard…** and
  **Clear selection**. `S` with a selection is **Start N**. Start asks first: how many start now and how
  many wait in the host's queue, the host's 5-hour window on a subscription, a line for each hold that
  keeps new cards waiting (the quota's pause limit, a budget at its limit, the host short of memory, the host with new runs paused),
  with every card in the queue while one of them holds, and the cards it skips and why. When some of the cards would wait (the host is full, paused or held)
  and another online host has the same project (the same repository) with enough free places, the
  confirm also offers **Start on <host>**: it makes each of those cards on that host and starts it
  there, then marks the card here "Started on <host> as <card>" and moves it to **Done**. Nothing is
  deleted: move the card back to **Backlog** to undo it. A card whose template names a workflow or a
  persona, a card waiting on a blocker and a card that holds others up are not offered: they would
  start differently there, or going to Done would free the others too soon. Stop asks first too: a running card's turn is cut off and it waits in **Needs you**, a queued
  one goes back to **Backlog**, and worktrees, branches and commits stay. The cards go one at a time;
  the ones that went leave the selection, and the bar names any the host refused. **Update N from the
  base** shows while a selected card has a branch and is not running: after the base branch moves, it
  rebases those cards on it, one at a time, with "Updating 2 of 5…" on the bar. A card already on its
  base is left alone, and a conflict stops only that card: the host aborts its rebase, so its worktree
  stays as it was. The summary then names the updated, already current and conflicted cards, and any
  the host refused, with why; the conflicted and refused ones stay selected. In a narrow window the bar
  says how many selected cards are in columns not shown, and **Move to…**, **Update N from the base**
  and **Discard…** sit under ⋯. Dragging a selected card drags the whole selection into the
  column you drop it on, in the board's order; dropped on a card, they land before it.
- **What a column asks of a card** (#78). **In review** asks for a PR link and passing checks;
  **In progress** asks for acceptance criteria, a checklist item (`- [ ] …`) in the card's
  description. The other columns ask nothing. A card that lacks something says so on itself
  ("Needs: a PR link"), and while you drag a card the columns that ask something say what, with a
  dashed edge. Moving a card to **In review** by hand (drag, the card's menu, or the selection bar)
  asks first and names what is missing; **Move anyway** moves it, and with several cards one
  dialog lists every card that lacks something, with **Move only the ones that qualify**. **In
  progress** only shows its note, it never asks, so starting work stays one move. Moves the app
  makes by itself (a PR opens or merges, a session fails) are never asked about. The host keeps each
  project's own contracts and checks your moves too: a move it would refuse says what the card lacks.
  **Move anyway** tells the host to go on, and the card keeps a notice ("Moved to In review anyway;
  it lacked a PR link"). The host never refuses what moves cards by itself: the manager, the board
  sync, the PR watch and PR events.
- **A validation note and starting without criteria** (#78). A card has a **Validation note** in
  its Details: a line or two on how you checked the work. A project can make a column ask for it
  (a contract with the `validation` check), and the card then says "Needs: a validation note".
  An empty note shows the shape of a note as a hint, never saved: a trusted project can give its own
  as `.flightdeck/templates/validation.md` in its checkout (at most 32 KiB), and the card says why
  when that file is there but was not used.
  **Start** (the card's menu, the Run section of the card, or the Ctrl+K palette) asks first only
  in a project whose In progress contract confirms acceptance criteria and only for a card with
  none (no `- [ ] …` item in its description): **Start anyway** goes on. By default In progress
  only hints, so Start asks nothing.
- **A spec file** (#78). A project can make a column ask for a **spec**: the card's worktree must
  have the spec file the card names, `docs/specs/<card name>.md` unless you set another path in the
  card's **Spec file** field (a relative path to a `.md` file inside the worktree). The card page
  says what the host found ("Spec found: <first heading>" or "No spec file at <path>") and **Check
  again** looks once more; a move to a column that asks for it looks at the file first. The host
  checks only that the file is there (a plain, non-empty file, not a link, inside the worktree) and
  reads its first heading: it never reads or sends the rest. When a card starts for the first time
  and its project asks for a spec, the host writes one from a template, as a draft
  (`draft: true`, which keeps the spec check unmet until it is completed). A trusted project can
  supply its own template as `.flightdeck/templates/spec.md` in its checkout (`{{title}}` and
  `{{criteria}}` are filled in); when a template is there but cannot be used, the built-in one is
  written and the card says why: the project is not trusted, the file is a link or has a second
  name, is over 32 KiB, or is empty. The notice never quotes the template.
- **Card templates** (#1201). A trusted project can list card templates in
  `.flightdeck/templates/cards.json` (at most 32 KiB, 12 templates): each has an `id`, a `name`, and
  optionally a `description`, `criteria` (a list, written as `- [ ]` items), a `workflow`, a
  `persona`, `pins` (library documents) and a `spec` file. **New card** then offers **From a
  template**; picking one fills the empty description and says what else the card starts with. The
  card gets the template's spec file and pinned documents, and its page opens with the template's
  workflow and persona already chosen, when the project and the host still have them. A template
  with a mistake is left out and counted; a file that cannot be used (the project is not trusted, a
  link, too big, empty, not a list) is said in **New card** with the reason.
- **Pinned documents** (#76). On a host with a project library, the card page has a **Pinned
  documents** panel: choose a document of the library (ADRs, RFCs, PRDs, specs) to pin it, up to
  10, and **Unpin** takes one off. When the card starts, its first prompt lists each pinned document
  that is in the card's worktree, with its title, and tells the session to read them. Only the path
  and the first heading go in the prompt, never the document's contents. A pinned document marked
  obsolete is still named: you chose it.
- **A card the host refuses to move** (for example, completing one that is still running) stays
  where it was, stays selected, and is named in a notice with the host's reason. The others move.
- **Discard…** shows one dialog with every selected card, and says what goes with each: a
  worktree or branch loses uncommitted changes and unpushed commits, a session is closed. If the
  host cannot discard a card, the notice says it may be partly cleaned up. Cards that never started are deleted; started ones are discarded.
  Cancelling leaves everything as it was.
- **Column width.** The handle at the right edge of a column (drag it, or Tab to it and press the
  arrows, 20 px a step, or Home and End; only the last column's handle takes a Tab stop) sets one width for all the columns, between 180 and 520 px, and it is kept on this computer.
  Until you set one, the five columns share the width of the window (at 1280 px each is about 187 px,
  and wider windows make them wider), so none is cut at the right edge. When the window is too narrow
  for that, or once you set a width, the board scrolls inside itself, never the page.
- **Counts.** Each column shows how many cards it has; with a filter on it reads `n / total`, and a
  column the filter emptied says "No matches" instead of offering a new card.
- **New card in a column.** The **New card** button at the bottom of a column creates the card
  there (it appears on hover and on focus, and always on a screen without a pointer).

## Starting a session from the task

**New session** opens on **First prompt**, with the cursor in it: write the task and press
**Create session** (or **Ctrl+Enter**). The folder, the permission mode and the model start as the
last session on that host used them (**Bypass permissions** never does: it asks every time). The
agent, subfolder, name, effort and persona are under **More options**, which opens by itself to
show a remembered subfolder.

In the **Ctrl+K** palette, a sentence typed with one project in scope offers **Start in <project>:
<text>**: **Enter** starts a session in that project's folder with the text as its first prompt,
in the same mode and model, and opens it.

## Choosing a folder

**New session** and the project form have a **Browse…** button next to the folder. It opens a
dialog that lists the folders **of the host** (which may be another machine), one level at a
time:

- it starts at the host's `allowedRoots` and only ever shows folders inside them: no files,
  no hidden folders unless you tick **Show hidden folders**, at most 500 per folder;
- a breadcrumb names every step, **↑** goes up, the arrow keys move through the list, **Enter**
  opens a folder and **Backspace** goes up;
- **Choose this folder** hands its path to the form. It is disabled, with the reason beside it,
  until you open a folder;
- when the host is this machine, **Choose with the system dialog** opens the operating system's
  folder dialog too. What it picks is checked by the host against its `allowedRoots`, like
  everything else, and a folder outside them is refused with the folders that are allowed.

Typing the path stays possible. The host command behind it is `fs.dirs`; a symlink that leads
outside `allowedRoots` is neither listed nor followed.

## Registering a project

In the app, the ▦ button next to the host opens **Projects of &lt;host&gt;**. Each project
records:

- **Repository path:** must be a git repository inside `allowedRoots`. **Browse…** opens the
  [folder picker](#choosing-a-folder).
- **Name** and **base branch:** when left blank, they become the folder name and the
  repository's current branch.
- **PR provider:** `github`, `azure-devops` or none.
- **Setup script** (optional, for example `bun install`): runs in the worktree before the
  session, with `cmd.exe` on Windows and `sh` elsewhere. It is the only shell command Flightdeck
  runs on its own, and it only exists if you register one. If it fails, the card goes to Needs
  you with the error output.
- **Instructions template:** appended to every card's prompt. The default asks to work only in
  the worktree and to commit with descriptive messages.

When a card starts, the daemon runs `git worktree add <repo>/.flightdeck/worktrees/<slug> -b
fd/<slug> <base>` and appends `.flightdeck/worktrees/` to the repository's `.git/info/exclude`
(`.gitignore` is not touched). The session's prompt is the card's description plus the template.

## Finding projects

**Find my projects** (on the **Projects** screen, for hosts that announce `projects.scan` and
`projects.clone`) has two parts:

- **Scan allowed folders** looks for git repositories under the allowed folders, two levels deep
  by default, up to 200 repositories. It skips hidden folders, `node_modules`, links and the inside
  of a repository it already found, and never opens more than 2000 folders. Repositories that are
  already projects are left out. Tick the ones you want and press **Add selected**.
- **Clone from an address** runs `git clone` into a folder inside the allowed folders and
  registers the result as a project. Only `https://`, `ssh://` and `user@host:path` addresses are
  accepted; an address that starts with a dash, has spaces, points to a local path or uses
  `file://` or a transport helper is refused, and so is a folder name that is not a plain name or
  a folder that already exists. git runs with password prompts off and stops after five minutes,
  so a private repository needs an SSH key or a credential helper already set up on the host.
  Every refusal says why.


## Starting from GitHub

For hosts that announce `github` there are two places:

- **Hosts, GitHub panel.** **Sign in with GitHub** asks the host's `gh` to start GitHub's device
  flow. The panel shows a one-time code: press **Open GitHub**, type the code on that page and
  confirm. The panel notices by itself and shows **Signed in as <account>**, where the login is
  kept (the system keyring, `gh`'s own file, or an environment variable of the daemon) and the
  permissions (`repo`, `read:project`). Flightdeck never sees your token: `gh` keeps it. **Sign
  out** asks `gh` to forget it; a login that comes from `GH_TOKEN` or `GITHUB_TOKEN` is managed by
  the daemon's environment and cannot be signed out here. If `gh` is not installed on the host the
  panel says so; install it and press **Check again**.
- **Projects, Start from GitHub.** Lists your repositories (or search them), then pick one and,
  if you like, one of its open issues. Choose the allowed folder to clone into and whether to open
  **A board card** or **A session**. The host clones the repository into that folder (or reuses the
  clone already there), registers it as a project, and then:
  - **a card** takes the issue's title, body and link (once per issue); an issue written by
    someone outside the repository's people is marked as third-party content and gets no
    automatic approval;
  - **a session** opens in the clone with the issue quoted in its first prompt, under the same
    mark when it comes from outside.
  Without an issue, only the repository is cloned and registered. A folder with that name that is
  another repository is refused, and every refusal says why.

To try it: on the host's page press **Sign in with GitHub**, confirm on GitHub, then on **Projects** press
**Start from GitHub**, pick a repository, press **Start**.


## Board sync with GitHub Projects

For hosts that announce `boardsync` (it needs the host's `gh` signed in, see **Starting from GitHub**), the **Sync**
button on a project's **Board** links the project to a GitHub Projects (v2) board:

- **Link board.** Pick one of your boards and press **Link board**. Its items become cards (an issue keeps its
  link and, when a stranger wrote it, the third-party mark with no automatic approval); the **Status** of each item puts
  the card in a column. After that the host reads the board every minute, and **Sync now** does it at once.
- **Status mapping.** Each status of the board has a column here: by default Todo and Backlog to Backlog, In Progress to
  In progress, In review to In review, Done to Done. Change a column and press **Save mapping**; a status set to *Not
  mapped* leaves cards where they are. *Needs you* has no GitHub counterpart, so cards that go there are not sent.
- **Read only by default.** Moving a card here changes nothing on the board until you turn on **Push my card moves to the
  board**. Turning it on asks to confirm and needs the `project` permission; if the login does not have it, the message
  says so and nothing is sent. Push only changes the Status of items that already are cards: it never creates, edits or
  deletes an item.
- **Conflicts.** If a card moved here and the item changed there since the last sync, the newest change wins. A tie within
  two seconds goes to the board when push is off and to this side when push is on. The value that lost is never dropped:
  the card's **Sync log** shows it, with both times. A card that is running is not moved by the board (the log says so).
- **On a card.** **Open on the board** opens the item; *No longer on the board* appears when it was archived or removed
  (the card stays); the **Sync log** lists conflicts, skipped moves and pushes that failed.
- **Unlink** stops the sync and keeps the cards, with their links.

To try it: sign in with GitHub on the host's page, open a project's **Board**, press **Sync**, pick a board, **Link board**.

## Card lifecycle

- **In review:** the card enters when a turn ends well. A turn that errors, is interrupted by
  Stop, or a permission request, sends it to Needs you.
- **Completion:** Complete (with confirmation) or a merged PR removes the worktree if
  `git status` is clean. Otherwise the card warns and the worktree stays.
- **Discard:** Discard (with confirmation, and a warning if there are unpushed changes) removes
  the worktree and the local branch.
- **The card page leads with one button:** its Run panel shows what comes next. **Start** for a card
  that has not run, **Stop** while it runs, **Review changes** once a run is done (it shows the
  card's Changes), then **Open PR**, and **Merge PR** once the PR is open and can be merged (the
  confirm below; while a session runs, **Stop** leads and **Merge PR** waits in the menu, and with
  failing checks it is not offered). The rest is under the **Actions** (⋯) menu next to it: **Start with a workflow or
  persona…** (the same dialog as the board's **Start card**), **Start**, **Start in the
  background**, **Stop**, **Open PR**, **Merge PR**, **Finish…** and **Discard**. A card whose run
  is done opens on **Changes**. While a run waits at a gate, the gate's own **Approve** and
  **Deny** at the top of the page are the only primary buttons: the Run panel leads with nothing
  until the gate is answered.
- **Edit and delete:** the card's **⋯** menu has **Edit…**, which opens the card with its title ready
  to change (the card page also edits the description and, with ROI on, the estimate), and
  **Delete…**, which names the card and asks first. Delete is only for a card that never started
  (no worktree, branch or session). For one that did, the dialog says why and offers **Discard card**
  instead. The cards that waited for a deleted card are freed of it, with a notice.
- **The Needs: chip** on a board card is a button. For what the card's own text lacks (criteria, a
  validation note, a spec) it opens the card with its title ready to edit; for a PR link or checks
  it opens the card, where its next step leads. It is not a Tab stop: from the keyboard, Enter on
  the card's title opens the card, and **M** then **Edit** opens it with its title ready to edit.

## PR providers

Open PR runs `git push -u origin fd/<slug>` and then calls the provider's CLI, with the card's
title and description:

- **GitHub:** `gh pr create --base <base> --head fd/<slug>`. State and checks come from `gh pr
  view --json state,statusCheckRollup`.
- **Azure DevOps:** `az repos pr create --source-branch fd/<slug> --target-branch <base>`. State
  comes from `az repos pr show`, and the policy checks from `az repos pr policy list`.

A project whose provider is **none** (the default for a new project, and what a repository with no
remote has) has no Open PR: the card's panel says so, with the steps (set the provider in the project's
settings; if the repository has no remote, `git remote add origin <url>` first, then `gh auth login`
or `az login`) and the branch the card's work is on, to push by hand. **Review changes** stays.

On a host that announces `prDetect`, the card page also reads the provider from the repository's
`origin` by itself when it shows (and the project's provider is still none), and **Check the remote
again** reads it once more after a `git remote add`. A `github.com` (or `*.ghe.com`) or Azure DevOps
remote is saved as the project's provider, a toast says so, and Open PR comes. Any other host is named
and left alone: Flightdeck does not pick a provider from a name that only contains "github", so a GitHub
Enterprise server is set by hand in the project's settings. If git cannot read the repository, the note
says that, instead of telling you to add a remote. A PR the host refuses keeps the dialog open with
the text you wrote, and the reason shown in it.

The CLI must be installed and authenticated on the daemon's host (`gh auth login`, `az login`
with the `azure-devops` extension). The daemon only invokes it, looking it up on the PATH. The
merge stays with the provider's rules: on GitHub, **Merge PR** on a card whose PR is open (and whose
checks are not failing) asks first, with the PR's address, its checks and the way to merge (a merge
commit or a squash), then runs `gh pr merge` with that way and nothing else: no `--admin`, no
`--auto`, no branch delete, so required checks and reviews still apply. If GitHub refuses, the
card says why (review required, checks failing or still running, a conflict, or GitHub's own
words) with a link to the PR, and the card stays where it is; when it merges, the card moves to
Done. When the host's conflict radar finds other cards of the project that change the same files,
the card shows **May conflict with …** on the board, lists those cards and the shared files under
**May conflict with other cards** in its details, and the merge confirm names them. It works over a near connection (this computer or Tailscale), and Azure DevOps cards merge
in Azure DevOps. Cards with an open PR are polled every 60 s, or every
`board.prPollIntervalMs` from the config. A merged PR moves the card to Done; closed without a
merge, to Needs you.

## Parallel run limit

`maxParallelRuns` (default 2) limits how many of the host's cards run at the same time, so
parallel agents do not exhaust the subscription's quota. Cards started beyond the limit stay in
In progress with the "queued" badge, in order of start. They start when a run finishes, is
interrupted or goes idle.

- Sessions opened outside the board do not count toward the limit.
- The limit lives in the daemon config and can be changed on the Projects screen, which writes it
  back to `config.json`:

```json
{ "maxParallelRuns": 2, "board": { "prPollIntervalMs": 60000 } }
```

- **Short of memory** (#1343): while the host's memory in use is at or above `resources.pauseAt`
  (90% by default, the Resources panel's **Critical**), a new card waits with "waiting for memory"
  and starts on its own once memory is 2 points under it; the host looks again every 15 seconds. Runs already
  going are never stopped. Change it in the host page's **Resources** panel (**New cards wait from
  memory at**, or **Never**), or in `config.json` (`{ "resources": { "pauseAt": 0.9 } }`, `null`
  to turn it off). When the host cannot read its memory, nothing waits; macOS, which counts its
  cache as used memory, is not read.
- **Pause new runs** (#1404): before restarting or updating a host, turn on **Pause new runs** on
  its page (Settings tab). New cards wait with "waiting: host paused", ahead of any other reason,
  and runs already going finish. The panel and the status bar say **Paused · 2 running**, then
  **Paused · idle** once nothing runs; the status bar item opens the host. **Resume new runs** lets
  the queue go. The pause is kept in `config.json` (`"pauseNewRuns": true`) across restarts, and
  only a near connection (this computer or Tailscale) can change it.

## Card dependencies

A card can be **blocked by** other cards of the same project, so an order you keep in your head is
on the board. Open the card, then **Blocked by**:

- **Add a blocker** picks from the project's cards; a card that would close a cycle (it already
  waits, directly or down the chain, for this one) is not offered, and the daemon refuses it too.
  A card has at most 20 blockers.
- A blocker is satisfied when its card is in **Done** (a merged PR moves it there, so does
  Complete), or, if you choose "merged", when its PR is merged. The choice is per blocked card.
- The board shows **Blocked · N** on a card that still waits (hover for the titles), **Blocking N**
  on a card that holds others up, and **Unblocked** on a card whose last blocker just finished.
  The **Blocked** toggle in the board's filters keeps only the cards that wait. The detail lists the
  blockers with their column and PR state, and the chain behind them to three levels ("and 2 more").
- **Start** on a blocked card is refused with a sentence that names the blockers. Nothing starts a
  blocked card: not Start, not the arena, not Claude's `flightdeckd mcp` tool. Moving a card by hand
  is not blocked: it moves a pin and starts nothing, and it is how you override the plan. A PR fix run
  (phase 22) is never held back, since its PR exists already.
- With **Start by itself when unblocked**, the card starts when its last blocker is satisfied,
  through the normal queue (slots, quota and budgets still apply), with the workflow you chose
  there, if any. Without it the card gets the **Unblocked** mark and the desktop notifies you; the
  mark goes when you start the card or dismiss it. A card starts by itself once, also after a
  daemon restart.
- A blocker that is **discarded** leaves the list at once, with a notice on the card, and the card
  is unblocked: it is never held by a card that is gone.
- A card that waited for blockers starts from the base branch **as it is after they merged**: the
  daemon runs `git fetch origin <base>` and starts the worktree from `origin/<base>` when the local
  base is behind it (a PR merged on the remote), and from the local base otherwise (a local merge
  already moved it). It never moves your local base branch. If the fetch fails, the card says so and
  the run starts from the local base.

Dependencies are inside one project: across projects the link would be a reminder, not a build order,
because a session builds on the merged branch of its blocker.
