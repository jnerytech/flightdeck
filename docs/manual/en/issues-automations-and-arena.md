# Issues, automations and arena

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/issues-automations-and-arena.md)

Three things from Phase 13, on the board and in the projects list. Each shows up only when the
daemon announces the feature (`issues`, `automation`, `arena`; daemon 0.13.0 or later). With an
older daemon the buttons are simply not there.

## Issues

The **Issues** button in the board header opens a side panel with the project's issues from
GitHub (through `gh`) or Azure Boards (through `az`). Connect a provider first, from the same
button: **Connect issues** asks for the provider and an optional search (blank means the open ones
assigned to you), and can allow the daemon to comment on the issue when the PR opens (off by
default, because it writes to the provider).

- **Filter issues** narrows the list by title, label or author.
- **Create card** makes a card in Backlog from the issue and keeps its link: the row then offers
  **Open card**, the card shows the issue (a button that opens it in the browser) and a PR that
  closes the card closes the issue (`Fixes #n` or `AB#id`).
- An issue from an **External author** is marked. Its text is third-party content: the card's
  automatic approval stays suspended until you resume it.
- Only `http` and `https` addresses are ever opened.

## Automations

In **Projects**, each project has an **Automations** button (on a daemon that announces
automation). The screen lists the project's automations, each with its trigger, action, daily
limit, an **Accepts outside authors** mark and an on/off switch.

- **New automation** is a guided form in three steps: trigger (schedule with cron and time zone, a
  new comment on a card's PR, a card's PR checks that failed, or a new issue with a label), action
  (start a workflow, send the event's content to the card's session, or create a card from the
  issue; the list only offers the actions that fit the trigger) and limit (name, firings per day,
  and whether to also act on outside authors, off by default).
- An automation **always starts off**, also after an edit. Turning it on shows the trigger and the
  action first and needs **Turn on**; turning it off needs nothing.
- **History** lists the firings: Ran, Failed, Ignored, Skipped, Daily limit or Missed (a schedule
  that fell while the daemon was stopped; it is recorded, not recovered).
- A firing that fails does not repeat by itself, and the quota and budget queues still apply.

## Arena

On a card that has not started, **Start in arena** runs the same request in 2 to 4 **variants**,
each with its own model and effort (blank means the host default), in its own worktree and branch
(`fd/<slug>-a`, `-b`...). **Add variant** and **Remove variant** change the count. Each variant takes
one slot of the parallel run limit and waits in the queue when there is none.

The card then shows the **Arena comparison**: one column per variant with its model and effort,
state, duration, estimated cost, files changed and workflow checks, and **Show changes** for the
variant's own diff. **Choose variant X** is available once the variant has stopped; it asks for
confirmation, makes that worktree the card's own and stops and removes the others.
