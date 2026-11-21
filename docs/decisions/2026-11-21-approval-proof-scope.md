# The approval proof stays on high risk and on saved rules; it does not cover every medium allow (issue #3451)

## Question

`docs/decisions/2026-11-20-high-risk-approval-proof.md` (#3439) puts a proof from the person's device on the
allow of a **high** request and on any allow that carries `updatedPermissions`. It says that a session can approve
its own **medium** requests with no proof. This record decides the scope: (a) high and saved rules only (today),
(b) every allow that is not low, or (c) high plus the medium kinds that can run code the session wrote or fetched.

## What was measured

How much of a session's work is medium, with the classifier of `apps/daemon/src/permissions/domain/risk.ts` run over
the tool calls of the eight newest Flightdeck session transcripts on the Pi (7,546 calls; a proxy, because the
permission table of this host is empty: its sessions run in bypass):

| Level  | Calls | Share |
| ------ | ----: | ----: |
| medium | 5,253 |   70% |
| high   | 2,269 |   30% |
| low    |    24 |  0.3% |

Medium is not a rare tier. Every shell command that no rule rates higher is medium (`risk.ts`, `shell`: the
default of a shell tool is `comando de shell`, never low), as is every write inside the project, every MCP tool that
is not destructive by name, the network tools, a read outside the project and any tool the classifier does not know.
Three in four of the medium calls above are shell commands. These calls are the work of the session; the requests
that reach `permission.respond` are the ones the project's rules did not already allow, and for them the share of
medium is the same or larger, because the high ones are the ones that always ask.

## Options

| | Covers | Cost for the person | Risk left |
| - | - | - | - |
| (a) high and saved rules | the high tier, `updatedPermissions` | none beyond today | a session approves its own medium requests |
| (b) every non-low allow | 99.7% of the requests above | a native signing dialog for nearly every request; a headless approval (app closed, a phone, `flightdeckd approve`) stops working for the ordinary case | a session can still run code through a medium request of a person who signs by habit; the dialog shows hashes, never the command (see #3439, "A compromised renderer") |
| (c) high plus the medium kinds that run code | shell commands, writes, MCP tools, network tools | the same as (b): the medium kinds that run code are 3 in 4 of the medium calls, and the text of a shell command cannot say which of them runs code the session wrote | the same as (b) |

## Decision: (a), and sharpen the classifier where a medium request is really a code-run

The proof stays on high risk and on any allow with `updatedPermissions` (a saved rule, including "allow for this
session"; every scope keeps that line). It does not cover every non-low allow.

Reasons:

1. **(b) and (c) make the proof an ordinary step.** A person who signs for 70% of the requests signs by habit, and
   a proof given by habit proves nothing: the dialog shows what the allow saves, never the tool or its command
   (#3439). The barrier would also close the headless paths for the ordinary case, which is the case people use.
2. **(c) cannot be cut from the text.** Whether a shell command runs a file the session wrote is not in its text
   (`bun run x.ts`, `bash ./script.sh`, `make`): to separate it the classifier would have to rate every command
   that starts a program of the project high, and that is (b) again.
3. **The sound way to protect the medium tier is to make the high tier sharper** where the medium request is
   a code-run by itself, so the barrier follows the risk and not the tier. That is a classifier change, outside
   the scope of #3439 and of this record: its own issue.

## The kinds of medium a session can approve for itself, with no proof

- **A shell command** that no rule rates high: a script it wrote and then runs, a test run, a build, any program of
  the project. A single command with `$(...)`, backticks, an encoded command or a pipe into a shell is high already.
- **A write inside the project** (`Write`, `Edit`, `NotebookEdit`), including a file the host or a tool later runs:
  `.git/hooks/*`, `.husky/*`, `.claude/settings*.json` (hooks and permissions), `package.json` (scripts),
  `.github/workflows/*` and `.vscode/tasks.json`. `isControl` (`sensitive-paths.ts`) names these, but only a saved
  rule consults it (`rule-risk.ts`); a single write to one of them is rated medium today (only `.mcp.json` and
  the credential paths are high). This is the one kind of medium the classifier can tell, and the one to move.
- **An MCP tool** whose name does not say `delete`, `drop` or `destroy`: the host cannot read what another server
  does.
- **A network tool** (`WebFetch`, `WebSearch`): it brings content from outside into the session; it runs nothing
  by itself, but what it fetches can steer the session.
- **A read outside the project and its allowed roots** that is not a credential path.
- **A tool the classifier does not know.**

An allow of any of these with `updatedPermissions` is already covered (a saved rule always needs the proof).

## Other answers that do not go through `permission.respond`

- **Auto-approve** (`apps/daemon/src/permissions/auto-approve.ts`) answers through `finish(..., "allow")` in the
  broker, not through `respond`, so the gate does not see it. That is by design: high risk and the network always
  go to the person, an automatic allow carries no `updatedPermissions`, and a project turns it on on purpose. It is
  the one way a medium request is approved without the person, and it stays out of the proof in every scope.
- **A saved rule** is an allow with `updatedPermissions`: covered.

## Consequences

- No code changes in this record: `needsApprovalProof` stays as it is, and `approval-gate.test.ts` already pins
  that a medium allow with saved rules needs the proof and one without does not.
- The sentence "Follow-up issue to decide: the proof for every non-low allow" in the record of #3439 now points
  here.
- Follow-up (classifier, its own issue): rate a single write to a control path (`isControl`) high, so a session
  cannot approve with no proof the write of a hook or a script it then runs. It reuses `isControl`, changes the risk of those
  writes only, and needs a risk test per path kind.
- Not decided here and not changed: a transport guard for commands open to a token holder, and `vault.approve`
  (their own issues).
