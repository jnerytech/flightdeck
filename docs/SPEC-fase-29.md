# Flightdeck — Phase 29 spec (Clients: grouping work across hosts and projects)

## Goal

A person who works for several clients has several machines and many project folders, and asks how to group that in
Flightdeck. Today the model has two levels and no way to say "this belongs to client A":

- a **host** is a machine (one `flightdeckd`);
- a **project** is a `projectKey`: the normalized git remote (`github.com/acme/api`), else `host:<hostId>:<folder>`;
- a **session** belongs to a host and a project.

Nothing crosses hosts except the Sessions list, "Needs you" and the search. Costs, budgets and the board are per host.
One machine often serves several clients, and one client's repositories live on several machines, so the grouping
cannot be "hosts under a client".

This phase adds one optional layer: a **Client**, kept by the app, global (it crosses hosts), that a project joins by
rules. A client switcher filters the work screens, and costs and budgets get a per-client roll-up. Nothing is required:
with no client defined, the app looks and behaves as it does today.

Origin: a request relayed on 2026-11-01 (three clients, N machines, N folders). Prerequisites: Phase 5 (central), Phase 8
(costs and budgets), Phases 16 and 19 (the vault and its rules), Phase 18 (snippets) and Phase 20 (personas), for the
per-client defaults.

**Out:** clients on the daemon, accounts or user permissions per client, invoicing, nested clients, tags on projects,
and enforcing a client budget on the daemons (see the open choices).

## Research (2026-11-01)

What comparable tools do, and what to take from it:

- **Toggl Track** ([data structure](https://support.toggl.com/data-structure-in-toggl-track)): client → project → task, one client per project, time entries
  attach to projects, never to clients; reports roll up to the client through the project. Take: **a client is only a
  roll-up of projects, never a place where work is attached.** Its optional third level (tasks) is paid and rarely
  needed: stop at one level above the project.
- **Harvest**: clients, projects and tasks are separate resources; a project links to a client, and a client can exist
  with no active project. Take: the same two-level shape; **a client with no projects is allowed.**
- **Linear** ([workspaces](https://linear.app/docs/workspaces)): one workspace per organization, teams inside it; it advises one workspace per
  purpose and offers a switch shortcut that does not log out. Take: **people who work for several organizations are
  served by a fast switch, not by nesting**, and a global "all" view is what they miss most.
- **Slack** ([UX case study](https://uxdesign.cc/staying-in-the-loop-on-a-work-communication-app-a-slack-case-study-9b6acea71025)): with four or more workspaces, people check constantly because activity in the
  other ones is invisible, and asked for one unified view. Take: **urgent items must cross the switcher.** "Needs
  you", the tray and budget alerts are never filtered by the selected client.
- **VS Code** ([multi-root workspaces](https://code.visualstudio.com/docs/editing/workspaces/multi-root-workspaces)): a multi-root workspace applies only resource settings and ignores
  window-wide ones, to avoid collisions; profiles are separate from folders. Take: **keep what is attached to a client
  small** (a filter and a roll-up), so nothing collides with host or project settings.
- **Termius** ([groups and tags](https://docs.termius.com/organize-and-connect-to-hosts/groups-and-tags)): nested groups with inherited settings; a host stays visible in the parent when moved
  to a child group, which people find confusing. Take: **one level, no inheritance chain.**
- **Warp Drive** and **JetBrains Gateway**: folders and connections are per project or per workspace and do not
  move across them (a folder of personal workflows cannot be dragged into a team workspace; a Gateway connection is
  bound to one project). Take: **membership must be a rule over an existing identity** (remote or folder), so
  nothing is re-created or moved by hand.

What fails, in short: **too many levels** (Termius nesting, Toggl tasks), **forced assignment** (a required project on
every entry makes people invent junk projects; Toggl keeps this an opt-in "required fields" setting on paid plans),
**hidden urgent work behind a switch** (Slack), and **membership by hand-moving** (Warp). The design below answers each:
one level, nothing required, an Unassigned bucket, urgent items never filtered, membership by rules with a manual
override.

## Design

### The model

- **Client:** `{ id, name, color, defaults }` and an ordered list of **rules**. One level: Client → Project (the existing
  `projectKey`) → Session. No nesting, no tags.
- **Rule kinds:**
  - `remote`: a prefix of the normalized remote, with `*` at the end (`github.com/acme/*`, `dev.azure.com/orgb/*`,
    `github.com/acme/api` exact);
  - `folder`: an absolute path prefix, optionally for one host (`/home/me/work/acme`, `C:\work\acme`). It matches with
    the existing `isInside` (case-insensitive, `\` as `/`). No `~`: a host does not tell the app its home folder, so
    the rule keeps the absolute path, and the form picks it with the existing `FolderPicker`.
- **Resolution** of a project to a client, in this order, first match wins:
  1. a **manual override** (`projectKey → clientId` or `→ none`, which pins the project to Unassigned);
  2. the clients' rules, in the order the person arranged them (clients first, then rules inside each).
- **The unit is the `projectKey`.** A remote-keyed project is the same on every machine, so it needs one rule. A folder
  rule needs a path, and a remote key has none, so the app keeps a map `projectKey → known cwds` taken from the sessions
  and the host's projects it already loads; a folder rule matches a remote-keyed project when any known cwd is inside the
  prefix. If two cwds of one key point to two clients, the first client in order wins and the Clients screen flags the
  conflict. A key with no known cwd and no folder in it (cost rows of a project never seen live) falls to Unassigned.
- **Unassigned:** a virtual client, present once at least one client exists, holding every project no rule and no
  override claims. It is listed in the switcher and cannot be edited or deleted.

### Where it lives

- **In the app, not on the daemon.** The client list, the overrides and the client budgets live in the app's `storage`
  (key `flightdeck.clients`, `{ v: 1, … }`), like the global snippets and the hosts; the selected client in
  `flightdeck.clientFilter`, like the hub's filter. No secret is stored. The protocol and every daemon stay as they are,
  and an older daemon works the same.
- **One small additive protocol change:** `Project` (the board's project, from `projects.list`) gets an optional
  `projectKey`, which the daemon already computes for budgets (`ProjectKeys.keyFor(path)`). Without it the Projects and
  Board screens could only be filtered by folder rules. An older daemon omits it and those screens fall back to the
  folder rules.
- **Export and import** of the client definitions as one JSON file (no budgets' spent values, no host tokens), so the
  setup can move to another desktop. Import merges by client id and never deletes.

### The switcher

- **Placement:** at the top of the sidebar, under the brand: a button with the client's color dot and name that opens a
  list: **All clients**, each client with its color and a count of its running or waiting sessions, **Unassigned**
  (with the count of projects), then "Manage clients…". It is hidden while no client exists.
- **Single choice**, not multi-select: one client or All. Default: All. Kept between starts. A shortcut and palette
  entries ("Switch client: <name>") change it without the mouse.
- **What it filters:** Sessions (rows by resolved client), the Projects and Board screens (projects by client), Costs
  (below), Budgets and Conversations (by `projectKey`). **Hosts stay all visible:** a host is infrastructure, not a
  client's.
- **What it never filters:** "Needs you", the tray and its menu, the notifications, budget alerts and the global
  search (Ctrl+K) searched across all clients. Each of those items carries a small client chip, and when a client other
  than the selected one has something waiting, the switcher button shows a dot with the count.
- **With All selected,** rows keep today's grouping by project and gain a client chip on the project header. No extra
  level is drawn.
- **Unassigned handling:** a project in Unassigned shows an "Assign…" action on its header: pick a client (a manual
  override) or "Make a rule from `github.com/acme/*`" (a new rule for the remote's first two segments). The Clients
  screen shows how many projects are unassigned. Nothing nags: no modal, no required step.

### The Clients screen

`Settings → Clients` (route `clients`, tab with the other global screens): list with add, rename, color and delete (its
projects return to Unassigned). Each client edits its rules (kind, value, host for folders, order) with a live
"matches N projects now" preview, and lists the projects that joined by override. **"Suggest from what I have":** groups
the remotes already seen by host and first path segment (`github.com/acme`, `dev.azure.com/orgb`) and offers one
client per group, to confirm. Nothing is created without a click.

### Costs and budgets

- **Costs roll-up, app-side.** The Costs screen picks one host today (`costs.summary` is per host). It gains an **All
  hosts** choice: the app asks `costs.summary` of every online host that has the feature, with the same period, and merges
  the rows by resolved client. A **"By client"** table sits beside "By project" and "By model", with the Unassigned row.
  The filter "client" narrows the totals. Days are each host's local day, so the day axis of a roll-up across hosts in
  different time zones can be off by one day at the edges; the screen says so once, in the subtitle. `costs.export` stays
  per host.
- **Client budgets, app-side and alert-only.** A client budget is a month limit on the roll-up. The app evaluates it
  from the merged month-to-date spend and raises the same 50/80/100% alerts as the daemon's budgets, once per month and
  threshold (the crossed thresholds are remembered in `storage`), through the "Needs you" budget-alert path. It **does not
  hold new cards:** that enforcement lives in each daemon, per host and project, and copying a client budget into
  per-project daemon budgets would drift as projects join and leave. The daemon budgets stay as they are and keep
  working inside a client.
- **Spend that cannot be placed:** a row of a project the app cannot resolve counts as Unassigned, never dropped, so the
  client totals and Unassigned add up to the host totals.

### Per-client defaults

`defaults` is `{ persona?, snippetTag?, vaultTag?, vaultScope }` and every field is optional. Each one only pre-fills,
orders or (for the vault, on an explicit opt-in) restricts. None of them changes anything for a project that is not
the client's.

- **Persona:** the persona opened by default in "New session", "Claude here" and a new card of that client's projects. It
  is a preselection, shown and changeable. A persona only ever narrows tools (Phase 20), so this adds no permission.
- **Snippets:** `snippetTag` makes the snippet picker, the snippets screen and the palette show that client's tagged
  snippets first, and pre-fills the tag on a snippet created while the client is selected. Untagged and other clients'
  snippets stay reachable (a search finds them).
- **Vault:** `vaultTag` (for example `client:acme`) does three things, all visible and none implicit:
  1. while the client is selected, the Vault screen lists secrets with that tag first, and the ones with no client tag
     under "Not tied to a client", so nothing is hidden;
  2. a secret created while the client is selected is pre-filled with the tag (editable);
  3. a read-only check on the Clients screen flags a tagged secret whose rules allow or ask for the project of **another**
     client, or whose `allowedHosts` is wider than the machines that hold the client's projects.

  **`vaultScope` (off by default)** keeps a client's secrets inside the client. The vault's rules are kept by the app and
  handed to the daemon (Phase 19), and a rule's `project` is one exact `projectKey`, so the app **generates**, for each
  secret with the tag, this rule set: one rule per project the client has right now, with the secret's current decision
  and conditions (for example `ask once per session`), followed by one `deny` rule for each of the requesters `claude`,
  `automation` and `workflow` with no project condition. The last three are what makes it fail closed: a project the
  list does not know yet falls to `deny`. The requester `you` (a use the person starts in the app) is not caught by
  them. The generated rules are marked and read-only in the rules editor, regenerated when the client's projects change
  (with a notice, never silently widened), and the daemon still validates them and applies its ceiling. Turning
  `vaultScope` on shows the exact rules first and needs a confirmation; turning it off removes only the marked rules and
  restores the secret's own ones. This is the one place where a client definition changes a security setting, so it is
  its own area with its own tests.

### Migration and compatibility

- **No data loss, nothing required.** Nothing exists before this phase, so there is nothing to migrate: with no
  `flightdeck.clients` key, or an unreadable one (the same tolerant parse the hosts use, falling back to an empty
  list), the switcher and the chips do not appear and every screen is as it was.
- Deleting a client or a rule only changes where projects are shown. No session, cost, budget or card is touched.
- The daemon change (`Project.projectKey`) is optional on the wire. The version is the maintainer's at release time.

### i18n

All text under `clients.*` in `en.ts` and `pt-BR.ts`, including the chips, the switcher, the rule form's labels and the
"matches N projects" and conflict messages. The client's name is the person's own and is never translated. The manual
(`docs/manual/en.md` and `pt-BR.md`) gets a "Clients" section with the three steps (create a client, add a rule, check
Unassigned) and the note that urgent items cross the switcher.

## Tests and criteria

| Area | What must pass |
| --- | --- |
| `clients-model` | the stored shape (`v: 1`) parses and a corrupt or missing value gives an empty list; add, rename, recolor, reorder, delete (projects go to Unassigned); overrides; export and import merge by id without deleting |
| `clients-rules` | `remote` prefix and exact; `folder` prefix with `isInside` rules (case, `\`), optional host; override beats rules; first match wins; the known-cwds map resolves a remote key by a folder rule; a two-client conflict is reported; a key with no cwd and no folder is Unassigned |
| `clients-suggest` | "Suggest from what I have" groups remotes by host and first segment, ignores folder keys, offers nothing already covered by a rule, creates nothing by itself |
| `clients-filter` | Sessions rows, Projects and Board lists, Conversations and Budgets filtered by the selected client, Unassigned included; "Needs you", the tray menu, notifications and budget alerts are never filtered; the global search covers all clients |
| `clients-costs` | the merge of several hosts' `costs.summary` by client with the Unassigned row, totals equal the sum of the hosts', the "client" filter, a host without the feature or offline is skipped and said so |
| `clients-budgets` | month roll-up, alerts at 50/80/100% once per month and threshold, remembered across a restart, shown through the budget-alert path, no hold on cards |
| `clients-protocol` | `Project.projectKey` optional in the schema, filled by the daemon from `ProjectKeys.keyFor(path)`, absent from an older daemon without failing the parse |
| `clients-defaults` | the default persona is preselected for a client's project in "New session", "Claude here" and a card and stays changeable; the snippet tag orders the picker and pre-fills a new snippet; a project of another client or Unassigned is untouched |
| `clients-vault` | with the tag: tagged secrets first and "Not tied to a client" after, nothing hidden; the tag is pre-filled on a new secret; the cross-client check flags rules and `allowedHosts` that reach another client; with `vaultScope`: the generated rule set is one rule per known project plus a `deny` for each of `claude`, `automation` and `workflow` (fail closed for a new project), `you` is not caught, the rules are marked and read-only, regenerated when the projects change with a notice, shown and confirmed before they apply, removed on turn-off with the secret's own rules restored, and the daemon's validation and ceiling still apply |
| `clients-ui` | the switcher (hidden with no client, counts, Unassigned, the dot for other clients' waiting items, the shortcut and palette entries), the chips, the Assign action, the Clients screen with its rule preview and Suggest, in both languages and both themes; axe clean |

A smoke is not needed: nothing new crosses the wire except one optional field, covered by `clients-protocol`. The prints
(`demo:shots`) gain the switcher open, a screen with All and with one client, the Unassigned header, the Clients screen
and the By client table, and the e2e journey creates a client with a remote rule, switches to it and back.

**Acceptance criteria:** the usual ones, and these: with no client defined every screen and print is pixel-identical to
before; a client's totals plus Unassigned equal the totals of the hosts; "Needs you" shows the same items whichever
client is selected.

## Open choices (recommendation first)

1. **Name.** *Client* (the person's word, as in Toggl and Harvest) over *Workspace* (collides with the saved window
   layout, `flightdeck.workspace`) or *Group*. **Recommend Client.**
2. **Where it lives.** App storage, no daemon change, over a daemon-side list per host (which would have to be kept in
   sync on N machines). Cost: it is not shared between two desktops, so Export/Import is included. **Recommend app-side.**
3. **One protocol field.** Add `Project.projectKey` (additive) over folder-rules-only on Projects and Board.
   **Recommend adding it:** without it a remote rule cannot place a board project.
4. **Switcher semantics.** Single choice plus All, over multi-select. **Recommend single plus All;** multi-select can come
   later without a stored-shape change.
5. **Client budgets.** Alert-only over also holding new cards through generated per-project daemon budgets.
   **Recommend alert-only** for the drift reason above; revisit if the person asks for a hard stop.
6. **`~` in folder rules.** Absolute paths picked with the folder picker over adding the home folder to `HostInfo`.
   **Recommend absolute paths now;** `~` is a convenience for a later phase.
7. **Vault scope.** All three defaults are in the phase. For the vault, the tag view, the pre-fill and the cross-client check
   are safe and visible. `vaultScope` (generated, fail-closed rules) is opt-in per client and shown before it applies.
   **Recommend keeping it opt-in and default off,** and building it last, after the tag view and the check, since it
   is the only client setting that changes a security rule. The alternative, a `client` condition understood by the
   daemon's rules, needs the daemon to know clients and breaks "no daemon change".
8. **Suggest.** One-click suggestions from the remotes seen over a blank start. **Recommend including it:** it is what
   makes the first setup a minute, and it creates nothing by itself.
9. **Day boundary of the cross-host roll-up.** Merge by each host's own day and say so, over converting to one time
   zone (the daemon only sends day strings). **Recommend merge and say so.**
