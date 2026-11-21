# The approval proof stays on high risk and on saved rules; it does not cover every medium allow (issue #3451)

## Question

`docs/decisions/2026-11-20-high-risk-approval-proof.md` (#3439) puts a proof from the person's device on the
allow of a **high** request and on any allow that carries `updatedPermissions`. It says that a session can approve
its own **medium** requests with no proof. This record decides the scope: (a) high and saved rules only (today),
(b) every allow that is not low, or (c) high plus the medium kinds that can run code the session wrote or fetched.

## What was measured

The classifier of `apps/daemon/src/permissions/domain/risk.ts` run over the tool calls of the eight newest
Flightdeck session transcripts on the Pi (7,596 calls; the permission table of this host is empty, because its
sessions run in bypass, so there is no better data; `RiskClassifier.classify(tool, input, cwd)` over every assistant
`tool_use` block of the eight newest transcripts under 120 MB, with `/home/ubuntu/repos` as the allowed root, run on
2026-11-21 at `1744466dd`; the script was not kept):

| Level  | Calls | Share |
| ------ | ----: | ----: |
| medium | 5,292 |   70% |
| high   | 2,280 |   30% |
| low    |    24 |  0.3% |

The limits of this sample matter, so the decision does not rest on the percentages. The sessions are coordinator
style (shell commands, messages, subagents, worktrees: 40 reads in 7,596 calls), half of the lines carry no
working folder (the classifier used the main checkout), and all of them ran in bypass, so these are calls, not the
requests a person was asked about. The sample says how the classifier sorts what these sessions do, not how often a
person would sign. The decision rests on the structure of the classifier:

- The only low requests are the reads inside the project (`Read`, `Grep`, `Glob`) and `TodoWrite`. **A shell command
  is never low**: `risk.ts` starts every shell tool at `comando de shell` (medium) and only raises it.
- Medium is therefore every shell command no rule rates higher, every write inside the project (`Write`, `Edit`,
  `MultiEdit`, `NotebookEdit`), every MCP tool not rated high, the network tools, a read outside the project and any
  tool the classifier does not know (`AskUserQuestion`, `Agent`, `SendMessage`, `Skill` and the rest).
- In this sample 75% of the medium calls are shell commands and, with the in-project writes, the kinds that can
  run code are 76% of it.

## Options

| Option | Covers | Cost for the person | Risk left |
| ------ | ------ | ------ | ------ |
| (a) high and saved rules | the high tier, `updatedPermissions` | none beyond today | a session approves its own medium requests |
| (b) every non-low allow | everything but a read inside the project | a native signing dialog for almost every request; a headless approval (app closed, a phone, `flightdeckd approve`) stops working for the ordinary case | a person who signs by habit proves nothing; the dialog shows hashes, never the command (see #3439, "A compromised renderer") |
| (c) high plus the medium kinds that run code | shell commands, in-project writes, MCP tools | close to (b): shell commands alone are about three in four of the medium calls in the sample, and with the writes and MCP tools it covers nearly all of them; the text of a shell command cannot say which of them runs code the session wrote | the same as (b) |

## Decision: (a), and sharpen the classifier where a medium request is really a code-run

The proof stays on high risk and on any allow with `updatedPermissions` (a saved rule, including "allow for this
session"; every scope keeps that line). It does not cover every non-low allow.

Reasons:

1. **(b) and (c) make the proof an ordinary step.** Almost every request a person is asked about is medium, so a
   proof on all of them is a dialog for each Bash command and each edit, signed by habit, and a proof given by habit
   proves nothing. The same weakness exists on the high tier (the dialog shows hashes, not the command); it is
   accepted there because a high request is rare and the person looks at it, which a proof on every command is not.
   The barrier would also close the headless paths for the ordinary case, which is the case people use.
2. **(c) cannot be cut from the text.** Whether a shell command runs a file the session wrote is not in its text
   (`bun run x.ts`, `bash ./script.sh`, `make`): to separate it the classifier would have to rate every command
   that starts a program of the project high, and that is (b) again.
3. **The sound way to protect the medium tier is to make the high tier sharper** where the medium request is
   a code-run by itself, so the barrier follows the risk and not the tier. That is a classifier change, outside
   the scope of #3439 and of this record: its own issue.

## The kinds of medium a session can approve for itself, with no proof

- **A shell command** that no rule rates high: a script it wrote and then runs, a test run, a build, any program of
  the project. A single command with `$(...)`, backticks, an encoded command or a pipe into a shell is high already.
- **A write inside the project** (`Write`, `Edit`, `MultiEdit`, `NotebookEdit`), including a file the host or a tool
  later runs. `isControl` (`apps/daemon/src/permissions/domain/sensitive-paths.ts`) names them: any path with a
  `.claude`, `.git` or `.husky` step (`.git/hooks/*`, `.git/config`, `.claude/settings.json`, `.claude/agents|skills|commands/*`),
  `package.json`, `.mcp.json`, `.github/workflows/*` and `.vscode/tasks.json`. Only a saved rule consults it
  (`apps/daemon/src/permissions/domain/rule-risk.ts`); a single write is rated medium today, except `.mcp.json`,
  `.claude/settings.local.json` and the credential paths, which are high. This is the one kind of medium the
  classifier can tell, and the one to move (#3614).
- **An MCP tool** that is not rated high: `__run_with_secret`, `__finish_card` with `outcome: discard` and a name
  with `delete`, `drop` or `destroy` anywhere in it are high; the host cannot read what another server does with
  the rest.
- **A network tool** (`WebFetch`, `WebSearch`): it brings content from outside into the session; it runs nothing
  by itself, but what it fetches can steer the session.
- **A read outside the project and its allowed roots** that is not a credential path.
- **A tool the classifier does not know** (`AskUserQuestion`, `Agent`, `SendMessage` and the rest).

An allow of any of these with `updatedPermissions` is already covered (a saved rule always needs the proof).

## Other answers that do not go through `permission.respond`

- **Auto-approve** (`apps/daemon/src/permissions/auto-approve.ts`) answers through `finish(..., "allow")` in the
  broker, not through `respond`, so the gate does not see it. That is by design: high risk and the network always
  go to the person (`risk.network` is true for MCP tools, `WebFetch`, `WebSearch`, network shell programs and a line
  the scanner gave up on), an automatic allow carries no `updatedPermissions`, and a project turns it on on purpose.
  It reaches the other medium kinds (a shell command with no network program, an in-project write, an outside read,
  an unknown tool), and it stays out of the proof in every scope.
- **A request from an external session** (`apps/daemon/src/central/external-permissions.ts`) runs the same gate in
  its own `respond`; a hook frame that carries no risk is read as low there. The hook sets the risk, so this is the
  daemon's own input, but it is not pinned by this record.
- **Bypass and the project's own allow rules** (`bypassPermissions`, `acceptEdits`, a rule already saved) clear
  requests before they reach the person, so no proof applies to them in any scope.
- **A saved rule** is an allow with `updatedPermissions`: covered.

## Consequences

- No code changes in this record: `needsApprovalProof` stays as it is, and `approval-gate.test.ts` already pins
  that a medium allow with saved rules needs the proof and one without does not.
- The sentence "Follow-up issue to decide: the proof for every non-low allow" in the record of #3439 now points
  here.
- Follow-up (classifier), #3614: rate a single write to a control path (`isControl`) high, so a session cannot
  approve with no proof the write of a hook, a settings file or a script that a tool then runs. It reuses
  `isControl`, changes the risk of those writes only, and needs a risk test per path kind. It covers those paths
  only: a source file the session writes and then runs through a medium shell command stays open (reason 2). It is
  a slice of (c) that the classifier can tell from the path alone, which is why it is taken and the rest of (c) is not.
- **What (a) leaves open, stated plainly.** A session with the daemon token can answer its own medium request with
  `permission.respond`, so the person's prompt for a medium request is advisory against a hostile or
  prompt-injected session. (a) is the least bad choice now, not a boundary of the host. The guard that would close
  it for every tier, a transport check on `permission.respond` and the commands open to a token holder, is its own
  decision (not decided here, not changed) and costs the person nothing, unlike (b); `vault.approve` is another
  one. Until one of them lands the barrier only raises the cost of the high tier, as #3439 says.
