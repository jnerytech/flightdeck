# Three commands that act past the session take the device proof (issue #3453)

Follows `2026-11-20-high-risk-approval-proof.md` (#3439). Read its threat and its proof first: this record
reuses the key, the daemon id, the nonce book and the refusals, and adds only what a command needs.

## Context

The record of #3439 ends with "what it does not stop": commands that are open to anyone who holds the
daemon token, and a session on the host holds it (same OS user, readable config). The daemon cannot tell the
app from a session, so the `confirm: true` that guards some of them proves nothing about a person. The issue
named four commands:

| Command | What a token holder does with it today | Guard today |
|---|---|---|
| `card.pr.merge` | merges the card's pull request on the provider with this computer's `gh` login; the daemon cannot undo it | `requireVaultTransport` and `confirm: true` |
| `project.trust.set` with `trusted: true` | lets the project's own hooks and MCP servers run with no prompt | `requireVaultTransport` and a refusal for a folder that holds many projects |
| `autoapprove.resume` | lifts the suspension of the automatic approver for a session or card, so it answers requests again with no person | `confirm: true` |
| `rules.remove` | removes an allow rule from `permissions.allow` of the project's `.claude/settings.local.json` | `confirm: true` |

`requireVaultTransport` is no barrier against a session: it passes any loopback address (`VAULT_NETWORKS`
includes `127.0.0.0/8` and `::1/128`), and a session on the host connects over loopback. It stops a connection
from the network, and nothing here counts on it as a guard.

The first acts on an outside system with the person's login. The second and third lower a guard on the
session itself, the same shape as the allow that #3439 closed.

`rules.remove` is not that shape. `removeRule` in `apps/daemon/src/board/project-rules.ts` filters `allowOf(settings)` and writes it
back: it can only remove an allow rule, never a deny, so after it a session is asked more, not less. The first draft of this
record, and the issue, took it for a guard-lowering command; it is not.

## Decision (coordinator, 2026-11-20)

`card.pr.merge`, `project.trust.set` and `autoapprove.resume` take the proof of #3439 when a key is
enrolled. `project.trust.set` takes it only when `trusted: true`: revoking trust lowers risk and stays open.
`rules.remove` stays on `confirm: true` (the coordinator confirmed the code and withdrew it from the list):
gating it would add a native dialog to a change that narrows what a session may do, and a person who wants
fewer allow rules would be refused at a terminal for nothing. With no key enrolled a command behaves as it
does today; the app shows the same "not protected" notice as for a high-risk allow (see "Downgrade" for a
host that has a key but not this feature).

### Options considered

- **A. One command gate over the same nonce book (chosen).** A short list of proof-gated commands, one
  challenge, one signed array that covers the command and its whole payload, one check in each handler. A
  fourth command is a line in the list and a call in its handler.
- **B. A bespoke challenge and message per command, as `permission.respond` has.** Each command would name
  its own fields in its own signed array. Rejected: three copies of the same check, and a field added to a
  payload later is easy to leave out of its array.
- **C. One unlock: the person signs once and every gated command passes for some minutes.** Fewer prompts.
  Rejected: the window is exactly the time a session on the host needs, and the signature would bind no
  command and no argument.
- **D. Keep `confirm: true` for the three and do nothing.** Rejected: it is the hole this issue exists to close.

## The proof of a command

- **The list.** `packages/protocol` holds one list of gated commands and one predicate,
  `commandNeedsProof(command, payload)`, that the daemon and the app both read (the way `needsApprovalProof`
  works for an allow). It is true for the three, and for `project.trust.set` unless `trusted` is `false`
  (a missing or odd value is gated, never open).
- **Challenge.** `approval.challenge` gets a third branch, `{purpose: "command", command}`, in the schema
  (`packages/protocol/src/approval.ts`) and in the handler (`handlers/approvals.ts`, where any purpose but
  `approve` is forwarded with no request id today and would lose the name). The name is `z.enum` of the
  protocol's list of gated commands, so no other string becomes a nonce key; each handler passes its own command
  name as a literal to `checkCommand`, never the client's field. The daemon issues a command challenge only
  when a key is enrolled (with none there is no proof to give). The nonce is issued for the purpose `command`,
  with the command name where an approval keeps its request id, so a nonce is good for one command only.
  `NoncePurpose`, `bucketOf`, `DEFAULT_CAPS` and `NonceBookOptions.caps` gain the purpose and a bucket named
  `command` (cap 32, so a per-connection quota of 16, the half of the cap that the book already applies): a
  command challenge needs no
  open request, so it must not share the approval bucket (a token holder with several connections would fill
  it and the app's allow challenges would get `approval_challenge_busy`) and must not share the small one of
  enroll and revoke (it would starve an enrollment). Life and use are as before: 60 seconds on the monotonic
  clock, one use. A token holder that opens many connections can still fill the command bucket for the 60
  seconds and renew it: the commands are then refused with `approval_challenge_busy`, which fails closed
  (nothing runs without the person). The record accepts this denial, as #3439 does for the other buckets: it
  does not make a command easier to run. (The caps of the other buckets are 256 for an allow and 16 for
  enroll and revoke; two loopback connections fill this one.)
- **What is signed.** The canonical JSON of the array `["flightdeck/command/v1", keyId, daemonId, command,
  nonce, H(canonicalJson(payload without proof))]`. `H` and the canonical JSON are the ones of #3439. The
  payload is the one the handler received, after its schema parsed it. `card.pr.merge` and `project.trust.set`
  have strict schemas (an unknown key is refused, so every field is bound); `autoapprove.resume` does not
  (zod drops an unknown key, which is then bound by nothing and has no effect). The app sends exactly the
  fields of the schema, and a test per command pins that the payload the app builds survives the parse
  unchanged. A field added to a payload later is bound with no change to the array.
- **`card.pr.merge` also binds the pull request and its head.** The merge acts on `card.prUrl` read when it
  runs, and `gh pr merge` merges whatever the branch holds then. A session that controls the card or owns the
  branch could repoint the address or push a commit between the person's review and the press. Its payload
  gets `prUrl` and `headSha`: the app fills them from the card it shows (the daemon adds the head commit to the
  card's pull request state, read from the provider, which it does not hold today), the daemon refuses with a new
  refusal code (named in that PR; no stale-state code for a card's pull request exists today) when either differs
  from the card's current ones, before the proof is taken. With a key enrolled a payload that omits either field
  is refused as a missing proof, so leaving them out never skips the binding; with none the fields are optional,
  as an old app sends none,
  and the provider call passes `--match-head-commit <headSha>` so a push after the check still fails. The person
  then signs the address and the commit, not an id. The comparison runs in `CardPrFlow.mergePr`, which takes
  the expected `prUrl` and `headSha` and checks them where it reads the card, so a later `await` cannot open
  a gap between a check in the handler and the read in the domain. The schema accepts `headSha` only as 40 or
  64 hex digits, so no value that starts with `-` ever reaches the `gh` arguments. This head binding is its own PR, before the one that
  gates the merge.
- **`project.trust.set` binds the folder the daemon trusts.** The handler resolves `path` against the allowed
  roots (`resolveAllowedCwd`, which follows links). A person who signed `/work/docs` must not trust another
  folder through a link or a relative path, so the handler refuses when the resolved path differs from the
  signed one, and the refusal carries the resolved path so the app asks again with it. The check compares the resolved
  path in the form the daemon stores (separators and case as the platform keeps them), and the app sends
  that form from the start, so a Windows path does not fail its first signature.
- **The field.** Each of the three payloads gets an optional `proof {keyId, nonce, signature}` (also in the
  two strict schemas; an old host that rejects it never sees one, see "Compatibility"). The `autoapprove.resume`
  schema becomes `.strict()` in its PR, so an app that drifts fails on its field and not on an opaque proof
  refusal.
- **Where it is checked.** In the handler, after its cheap refusals and before the domain call.
  `ApprovalGate.checkCommand` verifies the signature (a forged proof burns nothing), then takes the nonce, in
  one synchronous section, so a nonce cannot be used twice by two requests that race. The cheap refusals run
  first: `requireVaultTransport`, a missing `confirm`, the refusal for a folder that holds many projects, the
  resolved-path mismatch of `project.trust.set`, and a `prUrl` or `headSha` that no longer matches. A person is
  not asked to sign something the daemon will refuse anyway, and none of them carries a secret. `confirm: true`
  stays required, and the proof binds it. `autoapprove.resume` already checks it in its handler; for
  `card.pr.merge` the check is in the domain today (`merge_confirm` in `CardPrFlow.mergePr`), so the handler
  gets its own `confirm !== true` refusal before `checkCommand`; otherwise a merge with no `confirm` would
  burn the nonce first.
  The domain (`Board.mergePr`, `AutoApprove.resume`, the trust store) knows nothing about keys, so a call that
  does not come through the protocol is not gated: the gate is the protocol boundary and nothing else. Today
  no code but the handlers calls them, and a new caller must go through the same gate. A valid proof whose
  command then fails (a merge conflict) has used its nonce, and the app signs again.
- **Refusals.** The same as #3439: `approval_proof_required` for a missing proof, an unknown key, a bad
  signature, a used nonce or a nonce of another command; `approval_challenge_expired` past 60 seconds; nothing
  echoes a nonce, a key or a signature; the command does not run. `checkCommand` has a message of its own ("this
  command needs the confirmation of an enrolled device"), since the allow's text names an allow; the reason code
  and the refusal that does not say which part failed are the same. `approval_challenge_busy` for a command
  tells the person to look for a session that holds the challenges, and never to remove the device.
- **No key enrolled.** As today. A host that announced `approval-proof` and has no key shows the app's
  notice from #3439, and that notice is reused as it is; the per-command notice of "Downgrade" is new.
- **Compatibility.** The feature name is `approval-command`, announced in `host.info` (and added to the
  `protocolo-compat` and `recursos-fase13` lists). A new app against a host without it sends no proof, as
  before; an old app against a host that has it and a key enrolled gets `approval_proof_required` and shows the
  daemon's message.

## The app

- **One step for the three.** A command the predicate marks asks for a challenge when the person confirms,
  signs, and sends the proof with the command. The store helper that signs an allow is split in two (#3452
  does this split) and the command reuses its two halves.
- **The dialog shows what is signed.** The Rust signer receives the command name and the payload, computes the
  hash itself and builds the dialog from a fixed template per command and the fields of that payload: "Merge
  <pull request address> at <short head commit> by <method>?", "Trust the folder <path>: its hooks and servers will run with no
  prompt?", "Resume automatic approval for <session key>?". It shows no name the renderer supplies beside the
  payload, because such a name would be unsigned (a card title or a project name could say one thing while the
  bytes say another), so the resume dialog shows the session key as it is, which can read `card:<id>`.
  The text a person reads and the bytes signed cannot differ, which the dialog of an allow could not promise.
  The signer holds the three command names and the fields of each, and rejects a field it has no entry for. An
  entry is either a line of the dialog (the address, the short head commit, the method, the path, the session
  key) or a fixed field with no line (`cardId` and `confirm`, bound by the signature and not worth showing);
  shows a free-text field (`path`, a session key) quoted and escaped for line breaks and bidi controls, and
  refuses a value too long to show whole. The canonical JSON is the one of #3439, so the Rust side proves it
  with the shared test vectors, one per command; a payload JavaScript can build and Rust cannot hash (a lone
  surrogate) is refused, which fails closed.
  It is one more tag beside the approval, enroll and revoke tags of `lib.rs`, `TAG_COMMAND`. This is still a reduction, not a
  proof: the caveat of #3439 about a compromised renderer and a habitual Allow stays.
- **Downgrade.** The app's "not protected" notice is per command and keyed on `approval-command`: a host that
  has `approval-proof` and a key but not `approval-command` runs these three with no proof, and the app says so
  instead of showing the host as protected.
- **Cost.** Merging from the board was one click and becomes a click and a native dialog; the same for trusting
  a folder and resuming the approver. The texts exist in both languages: the app's dictionaries, and the Rust
  dialog, which takes its language from the app as the allow's dialog does.
- **Manual.** The chapters that describe these commands say that a host with an enrolled device asks for the
  device's confirmation, in `docs/manual/en/` and its pt-BR twin.

## The CLI

`flightdeckd autoapprove resume` (#3457) sends `confirm: true` over the token, which is the very hole. With a
key enrolled it is refused with `approval_proof_required`; the CLI prints that the person must do it in the
app, and exits 1 (refused), the line `approve` takes for a high-risk request in #3439. With no key it works as
before. Its command text says that with an enrolled device it is the person's to confirm in the app.
`rules remove` is unchanged. The CLI test pins that `autoapprove resume` sends exactly `sessionKey` and
`confirm`, the fields of the strict schema. `card.pr.merge` is already marked app-only in `docs/cli-parity.json` (for this
reason); `project.trust.set` has no command line and its row there is empty, which the cli-parity ratchet counts
as a gap, so the PR of `project.trust.set` marks it app-only with the same kind of reason (no new gap).
This is the same exception to "CLI first" that #3439 took for approving a high-risk request, and it has a cost: a
host reachable only by a terminal, with a device enrolled, cannot resume the approver until the person removes
the device with `flightdeckd approvers`.

## What it does not stop

- Everything under "what it does not stop" in #3439 applies unchanged: a session on the host can still enroll
  its own device (the host terminal opens the window), reset the keys, edit the store or the config, or read
  the app's key when both run as one user; a compromised renderer can ask for a dialog; and the barrier is a
  reduction, not a boundary of the host. A session with a shell can also run `gh pr merge` with the
  computer's own login, so the merge gate covers the daemon's path and not the provider itself.
- **What a person signed is that action only.** The proof of one command is not a proof of the next: the
  nonce, the command and the hash of the payload (with the pull request address for a merge) are all bound.
- **Commands that weaken the host and that a session reaches over loopback with at most `confirm: true`**
  (`host.updates.set` takes none; found by the security review of this record, checked against the code): `host.bypass` with `allow: true` (under bypass
  most requests are never asked, so the gate of #3439 has nothing left to check), `host.updates.set` with
  `auto: true` (the host downloads and runs a new binary), `roots.add`, `project.harness.apply` and
  `project.harness.commit` (they write hooks into a trusted project), `daemon.update.apply` and
  `service.install`. They are heavier than the three here, and without them the gate of #3439 can be
  walked around. This record does not gate them, because its scope is the three; the decision on them is its own issue
  (fd-specifier, opened after this record), and the answer may reorder the work below.
- **The trust commands and the rest.** `actions.trust`, `runenv.trust`, `workflow.trust` and the persona and
  snippet trust commands (they let a session save a file and then have it run unasked), `card.mergeLocal` and the
  other `confirm: true` commands (`card.complete`, `card.delete`, `card.discard`, `ssh.remove`). None is decided
  here; `rules.remove` is not on this list, it stays on `confirm: true` on purpose (see "Decision"); each is for its own issue, the trust commands first as the closest
  to `project.trust.set`.

## Consequences

- One gate and one list to read for every command that needs the device: a reviewer finds the whole policy in
  `packages/protocol` and `ApprovalGate`.
- Four small PRs: the head binding of the merge, then one per command, each carrying its refusal test, its
  handler check, the app's step and its manual text. The PR of `card.pr.merge` also carries the shared pieces
  (the nonce purpose and bucket, the challenge branch for a command, `checkCommand`, the Rust tag, the feature
  name, the per-command notice) and the cli-parity row of `project.trust.set`.
- The shared files are also touched by #3452 (`approval-gate.ts`, `handlers/approvals.ts`, `features.ts`, the
  Rust `lib.rs`, the app's approval store): that PR merges first and this work rebases on it.
- A host that never enrolls a device is exactly as it is today.

## Divergences found while building the merge (#3453)

- **The app reads the head, the daemon does not store it.** The first draft had the card keep the head commit
  it last saw. The merge now carries the pull request address and head commit the app read just before it
  signed, through a new read-only command `card.pr.head`, and the daemon compares them with a fresh read
  (`card_pr_stale`) and passes `--match-head-commit` to `gh`. Nothing new is stored on the card, and the
  person signs the head they saw, not one a card cached earlier.
- **A command challenge is issued with no key enrolled.** The nonce book hands out a `command` challenge to
  any caller, as it does for the other purposes; the gate is consulted only when a key is enrolled, so an
  unused challenge costs one entry in a capped bucket and decides nothing.
- **Old hosts.** A host from before this change has a strict `card.pr.merge` schema and no `card.pr.head`, so
  the app sends the binding and the proof only when the host announces `approval-command`.

## Divergences found while building the trust of a folder (#3453)

- **One feature per command.** `approval-command` now means only that `card.pr.merge` is guarded, and the host
  announces `approval-trust` when it also guards `project.trust.set`. A host that has the first but not the second
  is one the app says so of in the devices panel, one notice per unchecked command, and the app sends a proof only
  to a host that announces the feature of that command (an older strict schema rejects the field).
- **The folder is checked only with a device enrolled.** The signed folder must be the folder the daemon trusts, so
  with a device enrolled a `path` that resolves to another folder (a link, a relative path) is refused with
  `trust_path_differs` and the folder it is; the app sends the folder the host reports for the project, so a
  person meets this only when that report is stale. A host with no device behaves as before, links included.
- **The signer shows the folder and signs only the grant.** The shell reads `{path, trusted: true}` and nothing
  else, refuses a path that is empty, over 512 bytes, or holds a control, line-separator, zero-width or
  text-direction character, and names the folder in its dialog. Revoking is never signed.
- **A fix to the merge PR's note above.** The PR of `card.pr.merge` did not mark `project.trust.set` app-only; this
  one does.

## Order of work

1. This record, with `security-reviewer` on it before any code (this PR). The three PRs below do not wait for
   the decision on the host commands: each is a reduction of what a session can do through the daemon, and the
   answer to that issue may add commands to the same list.
2. After #3452 merges: the head binding of `card.pr.merge`, then `card.pr.merge` (the most consequential: it
   changes an outside system with the person's login), carrying the shared pieces. Then `project.trust.set` (`trusted: true`) and
   `autoapprove.resume`, one PR each; the last also gives the CLI its refusal line.
3. Each PR: `test(<area>)` red by assertion first (areas `board` for the merge, `projects` for trust,
   `permissions` for the resume and the gate), then the check, then the app's step, then the manual in both
   languages.
