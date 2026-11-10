# Costs, budgets and quota

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/costs-budgets-and-quota.md)

## The Claude account of a host

The host page has an **Account** card, above the usage panel, that shows which Claude account the
host's own `claude` is signed in to. Flightdeck never signs you in and never sees a token: it asks
the `claude` already installed on the host (`claude auth status`, plus the account and usage
reports of the Agent SDK), and Anthropic's terms keep a login out of third-party apps.

### Which account is this host using?

- The card shows the account's email, the organization, the plan (Pro, Max, Ultra, Team, Enterprise) and
  two bars, **5 hours** and **7 days**, with the percentage used and when each resets (hover for
  the exact time). The 7-day Opus and Sonnet bars show only when the host reports them.
- The plan comes from the sign-in of `claude` on the host, which keeps it from when you signed in:
  after a change of plan, sign out and in again there, then press **Refresh**. The bars are read
  live and are always current.
- It is read when you open the page and again every 5 minutes while the page stays open, and at
  once when a managed session ends a turn. "Last read 2 min ago" tells how fresh it is. **Refresh**
  reads now; it waits 30 seconds between reads.
- Each host has its own account. The email is shown on this card only: it is not put in
  notifications, the window title, the status line or the tray, and the daemon keeps it in memory,
  never in its database or logs.
- If a read fails, the card keeps the last reading and says "Could not refresh". If the host is
  offline, it says so instead of showing an old reading.

### What if the host is not signed in?

The card says "This host is not signed in to Claude." and shows the command **`claude auth login`**.
Open the host's terminal (the **Open terminal** button does), run it there, follow the steps, and
come back: the card updates. **Copy command** copies it. The card has no form and never asks for a
code or a token.

A host that uses an API key or a cloud provider (Bedrock, Vertex, a gateway) shows "Plan limits do
not apply": it has no plan windows. If the card says the account could not be read, check that
`claude` is installed on that host and press **Try again**.

## Plan quota

Each turn of a managed session carries the Claude plan's quota. All of a host's sessions use the
same login, so the quota belongs to the host. The daemon keeps the last reading of each window
(5 hours, 7 days and any others that come along), and a reading stops being valid when its
window resets.

- **On the Costs screen:** on a subscription the **Plan quota** block leads the screen, with the
  bars of each host, before the dollars (an estimate at API prices that the plan does not charge).
  A host on an API key has no plan window, so its screen leads with dollars.
- **In the app:** the top of the Sessions screen shows, for each Claude account, the 5-hour and
  7-day bars (hosts signed in to the same account share one card, named after all of them), with the percentage, the reset time and the age of the reading ("read 12 min
  ago").
  - The bar turns red from `quota.pauseAt`.
  - Crossing `pauseAt` raises a notification, once per window.
- **In the status bar** (the slim line at the bottom of the window, below): a small meter shows the
  window under most pressure across the online hosts, with its percentage and the time left until it
  resets (the window's name shows from 1024 px wide), and a **Refresh the plan usage** button that
  asks the hosts again. From 80% it carries a warning mark in the needs-you colour, and at 100% (or
  from `pauseAt`, as the account card) the bar turns red; its name and tooltip say the level, the
  host and the time left. Clicking it opens a panel with both windows of every online host and
  their reset times. In it, **New cards wait from** sets the guard (`quota.pauseAt`) of each host:
  50% to 100%, or **Never**. A host with an older flightdeckd shows it as text only. **Show what is
  running** opens the activity of every session, and each host has its own link to its page. The
  near-limit notice on the account card carries the same setting and the same action. Changing the
  guard never stops a session that is already running. With no reading, neither the meter nor the
  refresh shows.
- **Terminal only:** the hooks do not carry the quota. Anyone who only uses terminal sessions
  sees empty or stale bars until a card or a managed session runs on the host.

## The status bar

A slim bar (24 px) runs along the bottom of the window. On the left, the plan quota (above) with its
reset time and a refresh. On the right, each item opens its page:

- **Update:** only when there is one to say: an app update on offer, one downloaded that needs a
  restart, or a failed check. It opens Settings.
- **Keep awake:** what the hosts that offer it say together: **Awake** (holding the computer awake
  now), **Keep awake** (on, holding only while sessions run) or **Sleep ok** (off). It opens that
  host's page, where the switch is. A host that does not offer it is not counted.
- **Terminals:** how many terminal tabs are open, in both areas. It brings the first one forward; with
  none open, it opens the host where one can be opened.
- **Hosts:** how many are online of all ("2/3"). It opens the first host that is not online, so a
  problem is one click away; with every host online, the host in view.

Every item is a button with its words as the name and a tooltip, never colour alone, and the two
counts are live regions, so a screen reader hears them change.
In a window under 600 px tall the bar is hidden, to leave the height to the conversation.
In a window under 1024 px wide the words beside a value go to the tooltip and the button's name
(the icons and values stay). Under 640 px only the quota and keep-awake stay in the bar; the refresh,
the update, the terminals and the hosts are in a **More status items** list at its right end.

## Quota queue

```json
{ "quota": { "pauseAt": 0.9 } }
```

While any valid window is at or above `pauseAt` (or was refused by the plan):

- a started card is queued with the badge "waiting for the quota until HH:MM" and starts by
  itself when the window resets;
- a running workflow waits before the next agent turn, at the same point where it checks the
  budget;
- manual sessions are not blocked; the app only shows the warning.

`"pauseAt": null` turns the quota queue off.

## Usage

The host screen shows the last 7 days of usage, per day (in the host's timezone) and per
project. On a Phase 8 or later host (one that announces `costs`), the panel reads the costs of all
sessions (see [Costs](#costs)). On a Phase 7 host, it shows the usage of managed sessions:
estimated cost, tokens and turns.

- **Cost:** it is the difference of the total the SDK reports for each session, never the sum
  turn by turn.
- **Project:** the same as on the Sessions screen (the `origin` remote, or the repository path).
- **Grouped by project:** each project is one block with its total (the most expensive first) and
  its days below, newest first. Dates and costs never wrap.
- **Hidden:** temp folders (`temp`, `tmp`, `/var/folders`) and agent worktrees
  (`.claude/worktrees`) are not listed.
- **Open the sessions:** click a day to open History filtered by that project's folder and that
  day. A project known by its remote (shared by several folders and worktrees) opens History
  filtered by the project itself, so every one of its folders is listed; a "Project: name" chip
  above the list shows it, and **Clear project** takes it off.
- **Not in the usage:** terminal sessions, because the hooks carry no cost.

## Costs

The **Costs** screen, in the side menu, shows the cost of all of a host's sessions: terminal,
app, cards and workflows, subagents included.

> **Estimate:** the value is the API-price equivalent, estimated. On a Claude subscription,
> none of it is charged.

Dollars follow the app's language everywhere a cost shows: `US$ 1,234.50` in English,
`US$ 1.234,50` in Portuguese (#1332).

- **Source:** the Claude Code transcripts in `~/.claude/projects`, the same as the history.
  - Each message counts once, even when the transcript repeats it across several lines.
  - On the first boot of this version, the daemon reads the existing transcripts in the
    background and keeps answering meanwhile.
- **Period:** today, 7 days, 30 days, current month or a range, always in the host's timezone.
- **Data from:** every host, one host, or one project. The **Projects** group of the menu lists the
  period's projects, named as on Home; the choice is the same one Home and Sessions keep (#126). A
  budget alert or a Home card opens a project for that visit only.
- **Filters:** model and origin (terminal, app, card, workflow, subagent).
- **What it shows:**
  - the estimated cost, the tokens and the cache savings (how much less the cache read cost than
    the same volume as normal input);
  - a per-day chart stacked by project (Tab reaches the chart, the arrow keys walk the days, and a
    day says its total in a tooltip on hover or focus), and the breakdowns by project, model and
    origin;
  - the most expensive sessions, and clicking one opens it;
  - the estimated cost also shows in the session list, the open session, the card and the
    workflow run.
- **Export CSV:** saves, through the system dialog, one row per day, project, model and origin.
- **Warnings:**
  - models with no price show as "no price", with the name;
  - for managed sessions, the daemon compares the computed cost with what Claude Code itself
    reports, and if the difference exceeds 10% (and US$ 0.05), the screen warns that the price
    table may be out of date.
- **Retention:** usage is kept for `retention.usageDays` days (default 400).
- **Go to Costs** in the [palette](daily-use.md#palette-ctrlk) appears when the app has the Costs screen and
  some host announces `costs`.

## Prices

The default table is the API price list of 2026-10-06, in US$ per million tokens:

| Model | Input | Output | Cache read |
| --- | --- | --- | --- |
| `claude-fable-5-1` | 10.00 | 50.00 | 0.25 |
| `claude-opus-5-5` | 4.00 | 20.00 | 0.20 |
| `claude-sonnet-5-5` | 2.00 | 10.00 | 0.20 |
| `claude-haiku-5-5` | 0.10 | 0.50 | 0.01 |

- **Cache write:** 1.25x the input price for the 5-minute cache and 2x for the 1-hour cache,
  which is what Claude Code uses.
- **Haiku 5.5:** goes to 0.50 and 2.50 above 100 thousand prompt tokens.
- **Fast mode:** Opus 5.5's costs 2x.

To override, use `pricing` in the config, model by model:

```json
{
  "pricing": {
    "models": {
      "claude-opus-5-5": { "input": 4, "output": 20, "cacheRead": 0.2 },
      "claude-haiku-5-5": {
        "input": 0.1, "output": 0.5, "cacheRead": 0.01,
        "tiers": [{ "abovePromptTokens": 100000, "input": 0.5, "output": 2.5 }]
      }
    },
    "cacheWrite5mMultiplier": 1.25,
    "cacheWrite1hMultiplier": 2,
    "fastMultiplier": { "claude-opus-5-5": 2 }
  }
}
```

- **What changes:** a model in the config replaces that model's default. Models that do not
  appear keep the default.
- **Recompute:** the `costs.reprice` command rereads the config and recomputes the cost of all
  entries. No daemon restart needed.

## Budgets

In **Settings**, each host with costs has the **Budgets** section:

- **Setup:** each budget belongs to the host or to a project (the project key from the Sessions
  screen), per day or per month, in the host's timezone, with a limit in US$.
- **What counts:** the estimated cost of all origins. The list shows how much has been spent in
  the period and the percentage.
- **Alerts:** at 50%, 80% and 100%, once per period each, as a system notification and in the
  "Needs you" banner.
- **Action:**
  - **notify:** alerts only;
  - **hold new cards:** at 100%, new cards of that scope wait in the queue with reason
    `budget`. They leave by themselves in the next period or when the limit goes up.
  - Terminal sessions and manual sessions are never held.
- **Measured in:** on a host that reports the plan quota (a subscription), **Measured in** also offers a share of the plan's
  **5-hour window** or **weekly window**, instead of dollars. The limit is then a percentage of
  that window (0.1% to 100%) and the window is the period: the alerts and the hold start again
  when it resets. The host's share is the window's own use; a project's share is that use times the
  project's part of the estimated cost since the window began, so the list marks it **estimate**
  (the plan does not say who used it). A new reading of the plan counts at once. With no reading
  of the window the budget stays at zero and nothing alerts. A host with an older flightdeckd
  keeps the dollar form only.

## Quota history

Every quota reading from a managed session is kept for 30 days. Identical readings less than
5 minutes apart are merged into one.

- **On the Costs screen:** the **Quota** section shows the 5-hour and 7-day windows over time.
- **Projection:** with at least 3 readings of the current window:
  - "at the current pace, the 5 h window runs out at HH:MM";
  - or "won't run out before HH:MM", when the pace does not reach 100% before the reset.
- **Tooltip:** the bars at the top of the Sessions screen show the same projection.
- **Who used the window:** each project's share of the estimated cost since the start of the
  current 5-hour window. It is an approximate attribution, because the plan does not say who used
  the quota.

## Return on cost

For hosts that announce `roi`, the project's board page starts with a **Return on cost** card and the Costs screen
gains a **project table**, a **people table** and a settings block. It answers one question first: *did we deliver more
for what it cost?* Every figure is correlated and estimated: hours and rates are typed, not measured, and a card done is
not a verified result. The screens never call it profit or savings.

- **The card.** It starts folded to one row (the title, the first line below, and **Details**), so the board
  begins right under it; **Details** opens it and the choice is kept. Choose 7 days, 30 days or this month. The first line says how many items were delivered (cards done,
  split into *planned*, which were on the board before the period began, and *unplanned*, created and done inside it),
  what the agents cost, and whether that is more, fewer or about the same (within 5%) as the period before, with the
  cost per item of both. Below it: cards done and PRs merged, cost per card and per PR, the rework line (fix rounds and
  their cost), estimated hours and value marked as an estimate, and an 8-week trend with a text alternative.
  **How is this computed?** lists each number with its inputs.
- **Optional signals.** In the card's **Hours and rate** block, each project can switch on *agent commits* (commits of
  the period with a `Co-Authored-By: Claude` trailer; approximate, because a person can add the trailer too) and *issues
  closed* (asked of the host's `gh`, kept for an hour; the card says when `gh` is missing or signed out). Both are off by
  default.
- **The Costs table.** One row per project of the chosen client scope: cost, cards, PRs, cost per card and per PR,
  estimated hours, estimated value and return on cost (estimate). Click a column header to sort, again to reverse. A
  dash means the figure cannot be computed (no cards, no rate). The footer adds up the rows. **Export the project table
  as CSV** saves one row per project, with a column that says how each figure was made; the file always uses a dot as
  the decimal mark.
- **People.** *Tokens against delivery, by person* groups hosts into a named person (for example, the host that
  someone's agents run on) with a monthly token and/or cost limit. It shows the month's use against the limit, what was
  delivered, and tokens per card. People are listed by name: it is a view, not a ranking, and hosts are not people.
  Nothing is enforced; the existing host and client budgets are the ones that stop work.

### Where do I set the hourly rate?

The rate is the person's own money figure and stays in the app; the hosts never see it. The project's own rate wins,
then its client's, then the default.

- **Default and review time:** Costs, **Return on cost settings**. There you also choose whether *your* review time
  counts as cost (at most the cap you set for each decision; off by default, and the card shows the waiting time as
  information either way) and manage the people.
- **A client:** the **Clients** screen, **Hourly rate for this client**.
- **A project:** the card's **Hours and rate** block on the board page, which also holds the hours each card is worth by
  default. A single card's hours are set in the card's detail, **Estimated hours for this card**.

### Why is there no ROI for a project?

- **No rate:** the card says *Set an hourly rate to see the estimated value*; the cost per card and per PR still show.
- **No hours:** done cards without an estimate and without a project default are counted and named, and add no hours.
- **Nothing delivered:** the card says so and still shows what the agents cost.
- **No cost yet:** the ratio needs a cost above zero.
- **The host is offline or does not announce `roi`:** its figures are missing; the others still add up.
