# Flightdeck — Phase 38 spec (board sync with external boards, GitHub Projects first)

## Goal

GitHub issue #17: the app's board becomes an abstraction over external boards. Cards sync both ways with the provider.
GitHub Projects (v2) is the only provider for now; Azure Boards and others come later through the same interface. The
research, with sources and what is not verified, is in `flightdeck-handoff/board-sync-research.md`.

Prerequisites: phase 4 (the board and its columns), phase 13 (issues become cards, third-party marks), phase 37 (the
host's `gh` is signed in with `repo` and `read:project`).

Decisions (record any divergence in DECISIONS):

- **The provider is a seam, GitHub is its first implementation.** A `BoardProvider` interface in the daemon; the sync
  engine, the mapping, the conflict rule and the push rule know nothing about GitHub. A fake provider runs the same
  contract tests as the GitHub one.
- **GitHub goes through the host's `gh`** (`gh api graphql`), the way phase 37 does. The daemon never holds a token. The
  provider reports which scopes the login has, so a refusal can name the missing one.
- **Read-only by default.** Pulling needs `read:project`. Pushing is opt-in per board and needs `project` (write), which
  phase 37 does not ask for: switching a board to push first checks the scope and, when it is missing, refuses with the
  scope's name and says to sign in again with it.
- **Status only in version 1.** What syncs both ways is the board position (the Status column). Title and body are
  pulled, never pushed. A card made locally is not created on the external board.
- **Nothing is silently lost.** On a conflict the newest change wins and the losing value goes to the card's sync log. An
  item that disappears from the external board is flagged on the card, never deleted.
- **Polling first.** Webhooks (`projects_v2_item`) need a public URL the daemon does not have; they are a later issue.

## Proof of concept first

Needs a real token and a real Project (v2): a manual check, recorded in DECISIONS, not a test.

1. `gh api graphql` with the project query below on a user project and on an organization project: the output shape,
   the `REDACTED` item, a draft item, an archived item.
2. Whether a conditional request is honoured (`If-None-Match` and `304`) on GraphQL and on
   `GET /users/{user}/projectsV2/{n}/items`. If not, polling reads all pages each time (cheap: about 2 points for 200
   items).
3. The exact error text for a missing `project` scope on `updateProjectV2ItemFieldValue`.

The areas below run on fakes and do not wait for this.

## Design

**`BoardProvider` (apps/daemon/src/boardsync/provider.ts):**

```ts
interface ExternalBoard { id: string; title: string; owner: string; number: number; url: string }
interface ExternalItem {
  id: string;            // the provider's item id
  url: string;
  title: string;
  body: string;
  status: string | null; // the Status option's name; null when the item has none
  updatedAt: string;     // ISO time of the item's last change at the provider
  archived: boolean;
  content: { kind: "issue" | "pull_request" | "draft"; ref?: string; external?: boolean } | null; // null: REDACTED
}
interface BoardProvider {
  readonly kind: string;                                   // "github-projects"
  scopes(): Promise<{ read: boolean; write: boolean }>;
  listBoards(): Promise<ExternalBoard[]>;
  statusOptions(boardId: string): Promise<{ fieldId: string; options: Array<{ id: string; name: string }> } | null>;
  pull(boardId: string, since?: string): Promise<{ items: ExternalItem[]; cursor: string; notModified: boolean }>;
  setStatus(boardId: string, itemId: string, optionId: string): Promise<{ updatedAt: string }>;
}
```

A provider throws a `FlightdeckError` with a reason (below); it never throws a raw error.

**GitHub provider, GraphQL mapping (through `gh api graphql -f query=... -F name=value`):**

| Provider call | GraphQL |
| --- | --- |
| `listBoards` | `viewer { projectsV2(first: 50) { nodes { id title number url owner { ... on User { login } ... on Organization { login } } } } }` and, for organizations the person belongs to, `organization(login:) { projectsV2(first: 50) }` |
| `statusOptions` | `node(id: $board) { ... on ProjectV2 { field(name: "Status") { ... on ProjectV2SingleSelectField { id options { id name } } } } }` |
| `pull` | `node(id: $board) { ... on ProjectV2 { items(first: 100, after: $cursor) { pageInfo { hasNextPage endCursor } nodes { id isArchived updatedAt fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } } content { __typename ... on Issue { number title body url repository { nameWithOwner } author { login } authorAssociation } ... on PullRequest { number title body url repository { nameWithOwner } } ... on DraftIssue { title body } } } } } }` |
| `setStatus` | `updateProjectV2ItemFieldValue(input: { projectId, itemId, fieldId, value: { singleSelectOptionId } })` |
| `scopes` | `gh auth status` (phase 37's `github.status`) |

- Pages are read 100 at a time until `hasNextPage` is false, with a cap of 20 pages; a board past the cap is read up to
  the cap and the status says it was truncated.
- An item whose content the token cannot see is `REDACTED`: it becomes `content: null`, is kept as a link-only card, and
  the status counts it.
- An Issue's `ref` is `github:owner/repo#n`; its `external` flag is phase 13's rule (a stranger's issue is third-party).
- The query text is a constant; values go as variables, never concatenated. An id is checked against
  `^[A-Za-z0-9_=-]+$` before it is passed.

**Status mapping (per board).** Each linked board stores a `columnMap`: the provider's Status option name to a Flightdeck
column. The defaults, applied the first time the person links a board and editable in the UI:

| GitHub Status option | Flightdeck column |
| --- | --- |
| `Todo`, `Backlog`, `No status` | `backlog` |
| `In Progress` | `in_progress` |
| `In Review` | `review` |
| `Done` | `done` |
| anything else | not mapped |

- **Pull (external to local):** a mapped option moves the card to that column, unless its placement is locked or a
  session of the card is running (the board's own rules, `board/columns.ts`, decide); an unmapped option leaves the card
  where it is and counts in the status ("3 items have a status that is not mapped").
- **Push (local to external):** the reverse map, only for the five columns that have an option mapped to them. `waiting`
  has no GitHub counterpart by default, so a card entering `waiting` pushes nothing. Two options mapped to one column
  push the first one listed. A column whose option no longer exists is refused with `board_sync_option_not_found`.
- **New items:** an item not yet linked becomes a card in its mapped column (`backlog` when unmapped), with the item's
  title, body and link, `externalId` and `externalUrl`. An item of kind Issue goes through phase 13's path, so the
  third-party mark and the suspended auto approval apply. A draft item becomes a card with no `issueRef`. A pull request
  item becomes a card linked to the PR.
- **Gone items:** an item that is archived or no longer listed flags its card `externalGone` with the time; the card stays.

**Conflicts: the newest change wins, the loser is logged.**

- Each linked card keeps `externalStatus` and `externalUpdatedAt` (what the provider said last) and `localMovedAt` (when
  the card last changed column here, from the board's own event).
- On a pull, if the item's status differs from `externalStatus` **and** the card changed column locally since the last
  sync, that is a conflict. The provider's `updatedAt` is compared with `localMovedAt`; the later one wins. A tie within
  2 seconds goes to the provider when push is off and to the local side when push is on (the push then sends it).
- The loser's value, both times, the winner (`local` or `external`) and the source go to the card's **sync log** (a list,
  newest first, kept to 50 entries per card, never cleared by sync) and the card shows a marker until it is opened.
- A change on one side only is not a conflict: it is applied.
- Clock skew between this host and GitHub is not corrected; the 2 second tolerance and the log are the safety net. The
  log shows both timestamps so a wrong winner can be seen and moved back by hand.

**Push is opt-in per board.**

- `push` is `false` when a board is linked. `boardsync.setPush { projectId, push: true, confirm: true }` needs the
  confirm, checks `scopes().write`, and refuses with `board_sync_scope_missing { scope: "project" }` when it is missing.
- With push on, a column change of a linked card calls `setStatus` after the change is saved locally. A failure leaves the
  local change, logs it on the card (`push_failed` and the reason) and is retried at the next sync, at most 5 times, then
  it stays flagged. Push never creates, edits or deletes an item on the external board.
- With push off nothing is ever written to the provider; a test asserts that no mutation is sent.

**Sync loop.**

- One loop per linked board, started with the daemon; the interval is 60 s by default (15 s minimum, 10 min maximum, a
  setting). A run is never started while the previous one for that board is running.
- `pull(since)` takes the stored cursor: the ETag when the provider honours it (a `notModified` answer ends the run),
  otherwise nothing, and every page is read and compared with the stored snapshot by item id, `updatedAt` and status.
- A rate limit (`board_sync_rate_limited { resetAt }`) pauses that board until the reset time and shows when; other
  errors back off 1, 2, 4 minutes up to 15 and show the last error in the status. `boardsync.syncNow` runs a board at once.
- Stopping the daemon stops the loops; they hold no timer after `stop()`.

**Storage (migration):** table `board_links` (`project_id`, `provider`, `board_id`, `board_title`, `status_field_id`,
`column_map` JSON, `push` 0 or 1, `cursor`, `last_synced_at`, `last_error`, `truncated`, `paused_until`); `cards` gain
`external_id`, `external_url`, `external_status`, `external_updated_at`, `local_moved_at`, `external_gone`; table
`card_sync_log` (`card_id`, `at`, `kind`, `winner`, `lost_value`, `lost_at`, `kept_value`, `kept_at`, `detail`). A project
has at most one linked board in version 1.

**Commands (announced as the `boardsync` feature):** `boardsync.boards` (list the provider's boards),
`boardsync.link { projectId, boardId, columnMap? }`, `boardsync.unlink { projectId }` (cards keep their link fields and stop
syncing), `boardsync.setMap`, `boardsync.setPush`, `boardsync.status { projectId }` (last sync, counts, errors, paused
until, truncated), `boardsync.syncNow`, `boardsync.log { cardId }`. Event: `boardsync.updated { projectId }`.

**Refusals carry a reason:** `gh_missing`, `gh_logged_out`, `board_sync_scope_missing { scope }`,
`board_not_found`, `board_sync_field_not_found { field }` (no Status field), `board_sync_option_not_found { option }`,
`board_sync_push_off`, `board_sync_rate_limited { resetAt }`, `board_sync_already_linked`, `board_sync_not_linked`,
`board_sync_map_invalid`.

**App (second slice):** in the project's Board screen, a **Sync** control: link a board (a picker of the provider's boards
after sign-in; the mapping table prefilled from the defaults and editable), a status chip (synced N minutes ago, paused
until, last error, N unmapped, truncated), a **Sync now** button, a **Push changes to GitHub** switch with the confirm and
the missing-scope message, and on a card the external link, a conflict marker and the sync log. Strings in both
dictionaries; both manuals.

## Tests and criteria

All tests use the fake provider or the fake `gh` of `scripts/test/fake-cli.ts` (which answers `gh api graphql` by the
variables it is called with), a fake clock and an in-memory store. No network.

| Area | What must pass |
| --- | --- |
| `board-provider-contract` | one contract suite (scopes, boards, statusOptions, pull with pages and a cursor, setStatus, errors with reasons) run against the fake provider and, in `board-graphql`, against the GitHub provider |
| `board-map` | the defaults; both directions; an unmapped option; two options on one column; a column with no option; an invalid map is refused |
| `board-graphql` | each query and mutation is the constant text with the values as variables; pages are followed to the cap and say truncated; REDACTED becomes link-only; an Issue's ref and third-party flag; a missing scope, a missing Status field, a missing option, a rate limit and a not-found board each map to their reason; ids are checked before use |
| `board-pull` | a new item becomes a card in its mapped column with title, body, link and external id; an Issue reuses phase 13's card path and mark; a draft and a PR item; a status change moves the card; a locked card or a running session is not moved; an unmapped status leaves it; a gone item is flagged and the card stays |
| `board-conflict` | a change on one side only is applied; both sides changed: the later wins; a tie goes by the push setting; the loser's value, both times and the winner are in the log; the log keeps 50 entries and sync never clears it |
| `board-push` | off by default and no mutation is ever sent while off; switching on needs the confirm and the `project` scope, refused with its name otherwise; a column change calls `setStatus` once; a failure keeps the local change, logs it and retries up to 5 times; push never creates or deletes an item |
| `board-sync-loop` | polls at the interval and the minimum is enforced; one run at a time per board; a `notModified` answer ends a run; a rate limit pauses until the reset; errors back off and show; `syncNow` runs at once; `stop()` leaves no timer |
| `board-sync-store` | the migration; a project links one board; unlink keeps the card fields; the log is per card |
| `board-sync-protocol` | the commands and results are in the protocol; `host.info` announces `boardsync`; every refusal carries its reason; no token or query result body in a log |
| `board-sync-ui` | the Sync control, the mapping table, the status chip, the push switch with its confirm and scope message, the card's link and conflict log; both languages; refusals translated; axe clean |
| `board-sync-smoke` | `smoke:boardsync` runs link, pull, a local move, a conflict and a push against the fake `gh` and prints `SMOKE BOARDSYNC OK` |

**TDD order:** `board-provider-contract`, `board-map`, `board-graphql`, `board-sync-store`, `board-pull`, `board-conflict`,
`board-push`, `board-sync-loop`, `board-sync-protocol` (daemon slice), then `board-sync-ui`, `board-sync-smoke`.

**Locks:**

- No token, in any form, is read, stored, returned or logged; no mutation is sent while push is off.
- The query text is constant and every value is a variable.
- No call to the network from a test; no sync call and no floating promise in the new code.

**Acceptance criteria:** the usual ones, the proof of concept recorded in DECISIONS, both manuals, and the spec-verifier's
verdict is accept.

**Open questions for the maintainer** (a default is given; the phase follows the default unless told otherwise):

1. Ship read-only sync first and push in a second release? Default: build both, push off by default.
2. Create a card on the external board for a local card? Default: no, version 2.
3. Several boards per project? Default: one.
4. Pull a pull request item as a card? Default: yes, linked to the PR.
