# A second-opinion review before Open PR (issue #1431)

Feature 4 of #1401. A card's diff is judged done by the same agent that wrote it. Before **Open
PR**, the person can ask a second Claude call to read the diff and leave its findings as reviewer
comments on the card's **Changes**. This file settles how; the code follows it.

## Context (read on main, 2026-11-09)

- **One-shot calls already exist.** The runtime has one: `ClaudeSdkRuntime.complete` (and
  `judgePermission`), in `apps/daemon/src/runtime/claude-sdk-runtime.ts`. Its settings:
  - one turn (`maxTurns: 1`) and no tools (`tools: []`);
  - nothing read from the folder (`settingSources: []`, `strictMcpConfig`) and nothing kept
    (`persistSession: false`);
  - a dollar cap (`maxBudgetUsd`, the fixed constant `COMPLETE_BUDGET_USD` of 0.25 today, checked
    after the turn, so a soft cap) and an optional JSON schema for the answer (`outputFormat`).

  The wand (`assistant/service.ts`) and the harness draft (`harness/draft.ts`) use it.
- **No session is read-only.** A managed session cannot be read-only: a persona only lowers the
  permission mode (`clampPermissionMode`), and `plan` still lets Claude's own Read tool open any
  file. Flightdeck's guards on `file.read` (#509) do not cover the agent's tools.
- **The card's diff already hides credential files.** `card.diff` builds it in `board/diff.ts`.
  - A path on the credential list of #449 is marked `secret: true`, with no hunks (#509). The old
    path of a rename counts, and a binary or oversized file has no hunks.
  - One exception: `.mcp.json` keeps its hunks, with its values masked by `maskConfig` (#806).
  - Nothing else scans the diff.
- **A scanner for any text exists.** `SecretScanner` (`packages/protocol/src/snippets.ts`) runs on
  any text. Its `redact` swaps a match for `[redacted]`. It finds known token shapes and the values
  the vault and the daemon hold (6 characters or more), and nothing else. `Board.createPr` only
  calls `scan` and refuses on a match; nothing masks today.
- **Review comments carry no severity yet.** They live in `review_comments` (`ReviewComments`,
  `review/comments.ts`). A comment has a path, side, line range, quote and body. `add` quotes the
  lines and refuses a credential path. **Send review** delivers the drafts to the card's session
  (#1146).
- **Nothing checks the diff before a PR opens.** `Board.createPr` scans only the PR's title and
  body.
- **Every new run already passes the same gates.** They live in `Board.pump`: the host pause
  (#1404), the quota guard (`quota.pauseAt`), the memory hold (#1343) and the run budget.

## Decision

### Who reviews

- The review is a **one-shot call**, not a session. It uses the runtime's `complete`, with:
  - one turn and **no tools**;
  - no project or user settings, CLAUDE.md, MCP servers or hooks from the folder
    (`settingSources: []`, `strictMcpConfig`). Whether managed-policy settings are skipped too is not
    confirmed from this repository; the slice that builds it checks;
  - nothing persisted;
  - a JSON schema for the answer.

  It cannot open a file, run a command or write anything. It sees only what Flightdeck puts in the
  prompt.
- The instructions are those of the **Code reviewer** persona (`personas/pack/<lang>/revisor.md`),
  taken as text, plus a fixed request for findings. The persona's `tools` field does not apply, since
  the call has none.
- **Model:** the host's default model for one-shot calls, as the wand uses. A project can name
  another in its settings later; this slice adds no setting.
- **OpenCode** is left out of this slice. Its runtime has no tool-less one-shot call, and a plan
  agent can still read files. It follows when it has the same guarantees.

### The cost bound

- **Asked for, never automatic.** A **Review the changes** button on the card's Changes, offered
  when the card has a diff and no run is going. Nothing starts a review on its own.
- **One review per diff.** The review is keyed by the card's diff (its hash). Asking again with the
  same diff shows the last result and starts nothing; a new commit allows a new review.
- **The diff key is stored.** It is kept in the daemon's database, not in memory, so a restart does
  not allow a second review of the same diff. An in-flight lock refuses a second ask while one runs.
- **Each call is capped.**
  - `maxBudgetUsd` at 0.50 for this call, twice the wand's, since a diff is longer than a message.
    `complete` takes a fixed constant today, so the slice adds a per-call option. The cap is soft:
    the SDK checks it after the turn.
  - The prompt holds at most the diff budget `card.diff` already applies. A cut diff says so in the
    review, and the review covers only what it got.
- **It counts as the card's cost.** The usage is added to the card's cost and to its run budget, also
  when the answer fails the schema. A card at its budget cannot ask for a review.
- **The same holds as a run.** A review is refused, with the hold's own reason, while:
  - the host is paused (#1404);
  - the plan quota is at `quota.pauseAt`;
  - memory is at `resources.pauseAt` (#1343).

  It is refused, not queued: the person asked now, and the button says why it is off.

### What it reads, never secrets

- The prompt holds:
  - the card's title, description, acceptance criteria and spec file (when the card has one);
  - the diff, as `card.diff` gives it to the app.
- A credential file is in the diff only as its path, marked secret, with no content (#509). The
  prompt names it ("a credential file changed: <path>") and never its lines. The exception is
  `.mcp.json`, whose hunks arrive with their values masked (#806).
- Before the prompt goes out, the **whole prompt** (title, description, criteria, spec and diff)
  goes through `SecretScanner.redact`. A known token shape or a value the vault holds becomes
  `[redacted]`. It catches only those: a token typed into a source file that is neither a known
  shape nor in the vault still goes out.
- Nothing else is read: no other file of the repository, no transcript, no environment, no
  `.worktreeinclude` file.
- **What leaves the host:** the prompt goes to Anthropic, as the card's own session already sends
  its diff there.

### How findings become comments

- The answer must match a JSON schema: `findings: [{ path, line, severity, body }]`, at most 20.
  `severity` is one of `blocker`, `high`, `medium` or `low`, and `body` is at most 1000 characters.
  A summary of at most 500 characters comes with it. An answer that does not match is no review: the
  person sees "the review did not answer in the expected form", and nothing is saved.
- A finding whose `path` and `line` fall on a changed line of the diff (`side: new`) becomes a
  review comment through `ReviewComments.add`. That call runs the same path and credential checks as
  a person's comment and quotes the line itself, so the model's text never sets the quote.
- `ReviewComment` gains two optional fields:
  - `severity`;
  - `author: "reviewer"`. A person's comment has no author.

  A reviewer comment is a **draft**, marked as the reviewer's, with its severity.
- A finding that falls on no changed line, or on a secret file, is not anchored. It goes into the
  review's summary, listed under the comments, with its path and line as text.
- The model's text is data. It is shown as plain text, never as Markdown links or HTML, and never
  run.
- **The reviewer can be steered.** The diff, the description and the spec are written by others: a
  dependency, an issue body or an earlier session. Text in them can steer the findings. So a reviewer
  draft reaches the card's session, which has tools, only when the person presses **Send review**.
  The message marks each reviewer comment as "from the reviewer", so the session reads it as a
  suggestion, not as the person's instruction.

### What the person does with a finding

- **Accept:** the draft stays as a draft. It goes to the card's session with the person's own
  drafts when they press **Send review** (#1146). That is how "ask the card to fix it" works.
- **Edit:** a reviewer draft can be edited like any draft. It stays marked as the reviewer's.
- **Dismiss:** deletes the draft. A dismissed finding does not come back for the same diff.
- **Nothing blocks Open PR by default.** The Open PR confirm says "2 reviewer findings not
  addressed (1 high)" when drafts of `blocker` or `high` severity are still open, and opens the PR
  all the same. A project setting that makes them block can come later; this slice does not add it.

### Where it runs, and who may ask

- The call runs on the card's host, with that host's Claude login, like the card's own runs. It
  needs the board and the runtime's one-shot call. Without them, the host does not list the feature
  (`cardReview` in `host.info`), and the app shows no button.
- **Asking needs a near connection** (this computer or Tailscale), checked with
  `requireVaultTransport`. `card.start` itself has no transport check in its handler, and a far peer
  must not spend the host's quota or send its diff out through repeated asks.
- The call's `cwd` is the card's worktree, which the board looks up. It never comes from the request.

### The security-reviewer's read of the spawn

The security-reviewer agent read a draft of this decision against the code (2026-11-09). Its
verdict was "changes needed", with no high finding. Its corrections are in the sections above: the
`[redacted]` marker of `SecretScanner.redact`, the `.mcp.json` exception, the cap as a new soft
option, the stored diff key and its lock, injection through **Send review**, and a near connection.
Its read:

- **The call can only answer.** It has no file, command, MCP or hook access: one turn, `tools: []`,
  `settingSources: []`, `strictMcpConfig`, nothing persisted. It returns text that the schema checks.
- **The prompt is the card's text plus the `card.diff` output.**
  - Credential files appear as a path only, except masked configs such as `.mcp.json`.
  - The whole prompt goes through `SecretScanner.redact`, which covers known token shapes and vault
    values only.
- **Findings are untrusted data from the diff's author.**
  - They are anchored only through `ReviewComments.add`, which re-checks the path and the credential
    list and takes the quote from the file.
  - They are shown as plain text, and they reach the card's session only on the person's **Send
    review**.
- **Cost has several bounds:**
  - one stored review per diff hash, and an in-flight lock;
  - a per-call cap (a new option, soft) and the card's budget;
  - the pause, quota and memory holds;
  - an answer that fails the schema still counts.
- **Who may ask:** a far connection is refused. The slice that builds this gets a new security
  review.

## Consequences

- The slice after this one (issue to be opened from #1431):
  - the one-shot review call with its schema, a per-call budget option, the redacted prompt, and the
    stored per-diff key with its lock;
  - `severity` and `author` on `ReviewComment`, and the `cardReview` feature;
  - the button, the reviewer drafts and the Open PR line, in en and pt-BR, with the manuals;
  - the security-reviewer again on the code.
- A cut diff gives a partial review, and the review says so. Reviewing the parts that did not fit,
  one per call, is left for later.
- OpenCode reviews and a blocking project setting wait for their own decision.
