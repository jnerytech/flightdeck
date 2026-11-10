# Workflows

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/workflows.md)

A card can run a workflow instead of a single session: a sequence of steps (agents, checks,
approvals by you), with a budget, followed and approved from the app.

## Declaring

Workflows are `.flightdeck/workflows/<name>.yaml` files, versioned in the repository itself. The
daemon always reads them from the project's base branch (`git show <base>:<path>`). A workflow
written by the agent on the card's branch is never used.

```yaml
name: feature
inputs: [task]
budget: { maxTurns: 80, maxMinutes: 120, maxCostUsd: 15 }
steps:
  - id: plan
    agent: { prompt: "Plan: {{inputs.task}}", permissionMode: plan }
  - id: approve-plan
    gate: { message: "Approve the plan?", show: "{{steps.plan.output}}" }
  - id: implement
    agent: { prompt: "Implement this plan and make commits:\n{{steps.plan.output}}" }
  - id: tests
    loop:
      max: 3
      until: { check: "bun test" }
      do:
        agent: { continue: implement, prompt: "The tests failed:\n{{loop.lastCheck.output}}" }
  - id: review
    parallel:
      - agent: { persona: seguranca, prompt: "Review the diff with a focus on security." }
      - agent: { persona: revisor, prompt: "Review the diff with a focus on readability." }
  - id: pr
    pr: {}
```

| Step | What it does |
| --- | --- |
| `agent` | Opens a session in the card's worktree. With `continue: <id>`, sends the message to that step's session. With `persona: <id>`, the session opens in that persona. The output is the assistant's text in the turn. |
| `check` | Runs the command in the worktree. Keeps the exit code and the last 8 KB of output. If the command fails, the run fails. |
| `gate` | Pauses until you approve or reject, with an optional note. The note is the gate's output. |
| `loop` | Runs the `check` of `until`. While it fails, runs the `do` (at most `max` times). When `max` is exhausted, the run pauses. |
| `parallel` | Runs the items at the same time, within `maxParallelRuns`. The outputs arrive in `outputs`, in the declared order. |
| `pr` | Pushes and opens the PR through the project's provider. |
| `cards` | `cards: { from: <agent step> }` raises the findings in that step's reply as Backlog cards. See below. |

Interpolation accepts only `{{inputs.*}}`, `{{steps.<id>.output}}` (`outputs` in a `parallel`)
and `{{loop.lastCheck.output|exitCode}}`, the latter inside a loop's `do`. An unknown reference,
an unknown field, a step without an `id`, or a `continue` pointing to a step that is not an
earlier `agent` are validation errors. An interpolated value larger than 8 KB is truncated.

## Trusting

`check` steps run shell commands: `cmd.exe /d /s /c` on Windows and `sh -c` elsewhere, like the
setup script. That is why every workflow must be trusted before its first run. On the Projects
screen, **Workflows of &lt;project&gt;** lists the base branch's workflows with their validation
and their `check` commands. **Trust** shows those commands and asks for confirmation.

- **What is stored:** trust stores the file's hash (sha256).
- **If the file changes on the base:** the hash changes, and the workflow asks for trust again.
- **Before each check:** the daemon verifies that the command is literally in the run's workflow
  and that this content is still trusted. Any other command is refused before reaching the shell.

## Raising cards from an agent's findings

An agent step can end its reply with a fenced `json` block, a list of `{ key, title, body }`, and
a later `cards` step turns it into cards in the project's Backlog. The step reads only the last such
block, and it is strict: a field that is not `key`, `title` or `body`, a `key` that is not a plain
id of at most 160 characters, a one-line `title` of at most 160, a `body` of at most 4000, a control
or invisible character, or more than 50 items refuses the whole list. Nothing is created and the run
fails with the reason, which says which item and field.

A finding is not raised again when a card of the project already has its `key` (or one done in the
last 30 days), or an open card has the same title, case and spacing aside. A run creates at most 10
cards; the step reports how many it raised, how many a card already covered and how many were over
the cap. The cards are marked as the agent's text, show the external seal, and keep automatic
approval off, since what an agent reads in a repository can be written by anyone.

## Running a failed run again

A workflow run that failed, or ended because the card was stopped, shows **Run again** under its
reason on the card. It starts the card again with the workflow of that name as the file is now
(not as it was when the run began) and the same inputs, on the card's own branch, with the
column's default persona, and the earlier run stays in the card's history. It is off, with the reason next to it and
**Open Workflows** to the project's Workflows page, when the file is the problem: the workflow
changed since you trusted it, it has errors, or it is not on the base branch any more. If the host
refuses the start, the refusal shows in place.

A run that failed can also go on from where it stopped (#1266): **Run again from <step>** sits
next to **Run again**. The same run continues: the steps that finished keep their output and are
not run again, an approved gate is not asked again, and the failed step runs from scratch with
everything after it. The card's run waits for a slot like any run. It is offered only when it is
safe, otherwise the reason shows under **Run again**: the workflow changed since the run, the
card's branch changed since it stopped (a commit, reset or rebase), the card is gone or runs something else, or the
run ended before Flightdeck kept where the code was. It needs a near connection (this computer or
Tailscale): over a far one, that is the reason shown, and only **Run again** is offered.

## Templates

Three workflows ship with Flightdeck, for recurring work:

- **Tech-debt scan:** reads the repository (in plan mode, nothing pushed) for TODOs, deprecated APIs
  and lint or security warnings, and raises the 10 that matter most as Backlog cards. To run it every
  week, add an automation that starts this workflow on a schedule.
- **Alert fixer:** takes one lint or security alert that you paste in, fixes it on the card's branch
  with a test (up to 3 attempts against your test command), asks you, then opens the pull request.
- **Post-mortem draft:** drafts a post-mortem of an incident (summary, impact, timeline, cause,
  actions) as a Markdown file, marks what it could not verify, asks you, then opens the pull request.

Both stop at an approval before anything is pushed, and both have a budget of turns and minutes.
Once the pull request is open, the PR watch's round limit applies to it.

To start the alert fixer, start a card with it and fill the `alert` field. **Choose an alert** beside
the field lists the repository's open code-scanning and Dependabot alerts, the worst first, read by the
host with its own `gh` (read-only; Flightdeck holds no GitHub token). Picking one copies its text into
the field: read it before you start, since an alert's words come from a scanner or an advisory. A
source that cannot be read (code scanning is off, or `gh` has no access or is not signed in) is named
beside the list, and the list never says "no open alerts" when one of them failed. The button shows
only when the host can read alerts.

**Post-mortem from a failed card.** A card that stopped with a problem, or whose workflow run
failed, shows **Draft a post-mortem** in its detail. It opens the facts Flightdeck has of the
incident: the card, its problem, the failed steps of its run and the summary of its session. They
are plain lines, cut and cleaned, that you can read and edit. **Start the post-mortem** makes a new
card, "Post-mortem: <title>", and starts it with the Post-mortem draft workflow and that text; the
failed card is not touched. The button is off, with a note, when the project has not added that
workflow yet.

A template is a file. On the **Workflows** screen, **Add from a template** lists them. Open one to
read its file. Then add it in one of two ways:

- **Add to the project** (a host from this version on). Flightdeck asks first, then commits the file
  to `.flightdeck/workflows/` on a new branch from origin's copy of the base branch (your
  commits not pushed yet stay out), `flightdeck/workflow-<template>-<date>`, pushes it
  and opens a pull request into the base branch, as a card does. **View the pull request** opens
  it. The base branch and your checkout do not change: your current branch, your index and your
  unsaved files stay as they are. The commit uses the repository's `user.name` and `user.email`,
  and the project needs a PR provider. A template whose file is already on the base branch is
  refused.
- **Copy the file**, then commit it to `.flightdeck/workflows/` on the base branch yourself.

Either way, once the file is on the base branch, **Trust** it on the same screen like any other
workflow: it does not run before. The `check` line of the alert fixer already holds the project's test
command when Flightdeck can tell it (`npm run test`, `cargo test`...). When it cannot, the line
holds a placeholder that fails on purpose: replace it with your test command before you commit.
If the clipboard refuses the copy, the dialog says so as an alert: select the text of the file shown
there and copy it by hand. A host with no templates says that instead of showing an empty list.

## Running and following

In the card detail, pick the workflow (or **None (plain card)**), fill in the `inputs` and click
Start.

- **Timeline:** the detail shows each step with its status, attempt, duration and, for an
  `agent`, the turns and estimated cost. Clicking opens the step's conversation or the `check`
  output.
- **Open gate:** moves the card to Needs you and frees the host's slot. It shows on the card
  itself and in **Needs you**, with Approve, Reject and a note.
  - Once approved, the run goes back to the host's queue and carries on.
  - Rejected, it ends as `rejected`.
- **`pr` step:** moves the card to In review. The merge moves it to Done and closes the steps'
  sessions.
- **Daemon restart:** the run resumes where it stopped.
  - An agent in the middle of a turn resumes the session and resends the prompt, preceded by "The
    run was interrupted; continue where you left off."
  - A check runs again.
  - A gate stays open.

## Budget of a run

`budget` limits the whole run, summing all its sessions:

- **Turns:** counted across all sessions.
- **Minutes:** the wall-clock time of the turns.
- **Cost:** what the SDK reports (`total_cost_usd`). On a subscription, it is a useful estimate
  as a ceiling.
  - The value is cumulative per session: the last total of each session is what counts.
  - A resumed session counts only the difference.

The budget is checked before each turn. When exceeded, the run pauses in Needs you with the
reason. A paused run does not continue: start the card again. The meter in the card detail shows
turns, minutes and estimated cost. (Not to be confused with the host and project
[budgets in US$](costs-budgets-and-quota.md#budgets).)

## The flightdeckd mcp MCP server

`flightdeckd mcp [--config <file>]` is a stdio MCP server for the Claude Code on the same host.
It reads the daemon's config and connects to the local daemon over the protocol, with the
config's token. That lets a Claude session create cards and trigger workflows. Tools:

- `list_projects` and `list_workflows`;
- `create_card` and `start_card` (with `workflow` and `inputs`);
- `get_card` and `get_run`;
- `move_card` (to `backlog`, `in_progress`, `waiting`, `review` or `done`, by the same rules as
  dragging a card in the app), `update_card` (title, description), `comment_card` (appends a
  dated note to the description) and `finish_card` (`done` completes the card, `discard` throws
  it away with its worktree and branch).

A session manages only the cards of **its own project**, and its own card when it names none (the
session runs in a card's worktree); another project's card is refused with the reason. The board
in the app updates live. `finish_card` with `discard` is irreversible, so it always asks for your
approval in the session: the automatic approval never takes it, and no "always allow" is offered
for it.

There is no tool to approve permissions or to answer gates: that stays with you, in the app. To
register it in Claude Code:

```sh
claude mcp add flightdeck -- flightdeckd mcp
```

Sessions that Flightdeck starts itself (a team's coordinator and workers, board cards and plain
sessions) get this server with no setup: the daemon adds it to the session, next to your own MCP
servers. You only need the command above for a `claude` you open in a terminal outside Flightdeck.
The Doctor's "Team tools" line tells you when the daemon's program is no longer where sessions
expect it.

## The flightdeckd card command

`flightdeckd card` drives the board from a terminal, a git alias, a cron job or a CI step. It talks
to the daemon on the same host, with the token of the config file, like the MCP server above. The
daemon applies the same rules as the app: the queue, the holds and the limits.

```sh
flightdeckd card list [--project <name or id>] [--json]
flightdeckd card show <card> [--json]
flightdeckd card new "<title>" [--project <name or id>] [--description <text>] [--json]
flightdeckd card start <card> [--workflow <name>] [--json]
```

- `list` prints one line per card (project, id, column, title, and why a card waits). Without
  `--project` it lists every project. `--project` takes an id or a name; a host with one project needs
  no `--project` for `new`.
- `start` of a card that has to wait says why (a free slot, the plan quota, the host's memory, the
  budget, a paused host, the cards it waits on) and still exits 0: the card is queued.
- `--json` prints the answer for a script. Discarding and finishing a card stay in the app.
- **Exit codes:** 0 done, 1 refused (the reason is on stderr, with the daemon's code), 2 no daemon
  (not running, or silent for 15 s).
- **The token** comes only from the config file: `--token` is refused and the environment is not
  read. It is never printed. The command talks only to a daemon on the loopback (`127.0.0.1` or
  `::1`); a daemon bound to another address is refused. As with `flightdeckd mcp`, the token goes to
  whatever listens on that local port, so keep the daemon running when you use it.
- With `--json` the answer is JSON on stdout, but an error is still a line of text on stderr.
