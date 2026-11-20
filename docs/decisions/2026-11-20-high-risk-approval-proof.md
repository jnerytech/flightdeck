# A high-risk allow needs a proof from the person's device (issue #3439)

## The threat

A Claude Code session runs as the same OS user as `flightdeckd`. It can read `~/.flightdeck/config.json`
(mode 0600, same user), open a connection with the daemon token, and send `permission.respond` with
`held: true` for its own high-risk request, or run `flightdeckd approve <request> --hold` (#3425). The daemon
has one token (`server.ts`, `currentToken`) and the `hello` name is chosen by the client, so the app, the CLI
and a session look the same to it. `held` is the caller's own assertion (`requireHold`, `hold.ts`).
"Accepted only from a paired app connection" cannot be checked today: no connection is more paired than another.

## Decision: option A, as a device key (coordinator, 2026-11-20)

The person approves a high-risk request in the app, and the daemon checks a proof that only that device can
make. Option B (a one-time code in the CLI) stays out until a person asks for a CLI-only path. Option C (a
per-host secret on the same user) does not stop the threat and is not built.

### What the barrier covers

An allow of a request the classifier calls **high**, and an allow that carries `updatedPermissions` at any
risk level (a saved rule is a larger grant than one request; this includes the "allow for this session"
suggestions). A deny, and an allow of a low or medium request without updates, stay as they are. `held` stays as
the app's own check.

### The proof

- **Key.** The app makes a P-256 key pair per host on the person's device (so a signature never crosses hosts).
  The private key does not leave the device. The daemon keeps the public keys in its store (a table, not a
  file) and reads the table on every check and every enroll, with no copy in memory, so a reset or a window
  written at the host terminal takes effect at once.
- **Daemon id.** A random id made once at first start, kept in the store and returned in `host.info`. The app
  records it per host and signs it, so a signature made for one host is useless at another. It does not exist
  today; the daemon PR adds it.
- **Challenge.** `approval.challenge {requestId}` is answered only for an open request that needs a proof. The
  daemon returns a random nonce and keeps, in memory, the nonce, its request and its issue time on a monotonic
  clock. A request may have several live nonces (a session that asks again does not cancel the app's). A
  connection has its own quota. A full cap evicts the oldest expired nonce first, then the oldest of the same
  connection; a challenge refused for the cap says `approval_challenge_busy` and the app retries. The nonces for
  enroll and revoke have a separate cap. The app asks when the hold of the Approve starts, not when the card shows: the
  limit is 60 seconds from issue and one use.
- **What is signed.** The canonical JSON of the array `["flightdeck/approval/v1", keyId, daemonId, requestId,
  nonce, "allow", H(canonical(updatedPermissions ?? [])), H(canonical(updatedInput ?? null)), H(message ?? "")]`:
  an array, so no field can shift across a boundary. The answers of a question are inside `updatedInput`, so
  they are covered. The daemon recomputes each hash from the payload it received. Canonical JSON has
  keys sorted by UTF-16 code unit (RFC 8785); the app and the daemon share one
  implementation in `packages/protocol`, not the locale-sensitive `canonical()` of `permission-updates.ts`.
  The signature is ECDSA P-256 / SHA-256 in IEEE P1363 form (what WebCrypto makes; the daemon verifies with
  `dsaEncoding: "ieee-p1363"`).
- **Where it is checked.** In one synchronous section inside each `respond`
  (`PermissionBroker.respond` and `ExternalPermissions.respond`), not in the handler, which awaits the disk
  lookups before it calls them. The signature is verified after `bindInput` and `checkUpdates` (so a refused
  payload does not waste the nonce), and the nonce is consumed immediately before `finish` or `close`, in the
  same section: two answers cannot both pass. Both `respond` methods take the proof (`{keyId, nonce,
  signature}`) as a new parameter beside the held flag. With a key enrolled, the proof check replaces the
  `requireHold` check (which runs first today, `permission-broker.ts:176`, `external-permissions.ts:126`); with
  none, `requireHold` stays.
- **Refusals.** One reason, `approval_proof_required`, for a missing proof, an unknown key, a bad signature,
  a used nonce and a nonce for another request. `approval_challenge_expired` only for a nonce past 60 s, so
  the app can ask again. A refusal never echoes a nonce or a key. The request stays open.
- **Other ways a request is answered.** Auto-approve resolves with `finish(..., "allow")` and
  `ExternalPermissions` with `close(..., ALLOW)`; that is safe because a high-risk request always asks and an
  automatic allow carries no `updatedPermissions`. A test pins both. Abort, cancel and expiry are denials.
- **Compatibility.** An app that sends only `held: true` gets `approval_proof_required` and shows the daemon's
  message. The feature `approval-proof` is announced in `host.info` (and added to the `protocolo-compat` and
  `recursos-fase13` lists); a new app against a host without it sends `held` only.

### Enrollment

A token holder could enroll its own key, so enrollment is closed unless a person opens it.

1. **Closed by default, opened at the host, not over the protocol.** `approval.enroll` is refused unless a
   window is open. A person opens it with `flightdeckd approvers enroll` on the host (10 minutes, closed by the
   first enrollment); `flightdeckd pair` prints that hint after the pairing link. The command, and the reset
   below, are **not protocol commands**: the CLI writes the store directly (a `window_until` row with the hash of
   a one-time code; or deleting the key rows) and the daemon reads that row on each `approval.enroll`. No
   schema in `packages/protocol` opens the window or resets, and a test pins that no `approval.*` command does
   either. So a leaked token used from another machine cannot open the window or wipe the keys.
2. **One-time code.** The command prints a code of at least 128 bits at the terminal; the person types it into
   the app, and the code goes in the signed enroll payload. The daemon keeps only its hash, compares in constant
   time, and closes the window after 5 failed attempts. The code dies with the window. A session that did not
   run the command cannot read it from the store, so it cannot win the window by being first.
3. **Proof of possession.** The enroll message is signed with the new key over the canonical JSON array
   `["flightdeck/enroll-first/v1", daemonId, nonce, publicKey, codeHash]` with a daemon nonce (one use, 60 s;
   issued only while the window is open or to an enrolled key's request).
4. **Later keys** need a signature of an enrolled key over `["flightdeck/enroll-add/v1", keyId, daemonId, nonce,
   newPublicKey]`, with no window. **Revoke** is signed the same way (`"flightdeck/revoke/v1"`) and covers the
   target key id. The last key cannot be revoked through the protocol: only the host reset does that. A revoke
   of another key is announced as `approval.revoked`, with the detail of an enrollment.
5. **Seen.** Each enrollment is stored with the time, the client name and the address as the daemon sees it,
   announced as `approval.enrolled` and listed by `approval.list`. The app lists it on every connect and tells the person
   about a key it did not make; the app calls `approval.list` before it enrolls.
6. **Unenrolled host.** With no key enrolled the host behaves as today (`held: true` alone passes). The app
   shows "this host's high-risk approvals are not protected: run `flightdeckd approvers enroll` there", louder
   when it remembers that this host had keys and `approval.list` is now empty. Once a
   key is enrolled the proof is required for every client. The app also enrolls on a local host (so the person
   is not locked out), and says there that it protects nothing.
7. **Host reset.** `flightdeckd approvers reset` (host terminal) removes every key and returns to rule 6; it
   prints that the protection is now off.

## What it does not stop

- **The barrier is the high tier only.** The classifier is a text heuristic: anything it does not know is
  medium. A session can approve its own medium requests with no proof, for example a script it wrote and then
  runs. This barrier raises the cost of the high tier; it is not a boundary of the host. Follow-up issue to
  decide: the proof for every non-low allow.
- **Other self-asserted approvals.** `vault.approve` takes `via: "app"` and `heldMs` from the caller
  (`actions/domain/approval-check.ts`), so a token holder approves its own use of a secret. `card.pr.merge`,
  `project.trust.set`, `rules.remove` and `autoapprove.resume` are also open to a token holder. Follow-up
  issues to decide whether each takes the same proof; none is changed here.
- **A host and an app on one machine as one user.** The session reads the app's key store, so the barrier does
  nothing there (it falls back to option C).
- **A compromised renderer.** A script in the app's webview (the sessions' text is rendered there) can ask for
  a challenge and ask the app to sign. The signing is a Rust command that refuses unless the Approve press
  came from the person (the app PR states how it checks this); the palette's "approve the oldest" action, the
  `A` key and any notification or tray allow either go through that press or are refused for a high-risk
  request. It is a reduction, not a proof.
- **Same user, same reach.** A session on the host can run `flightdeckd approvers enroll` and read its own
  code, run `reset`, edit the store or the config, or restart the daemon with a different setup (a remote token
  holder cannot: rule 1). Only the app showing every enrollment makes that visible to the person. A session that
  enrolled first also locks the person out of high-risk approvals until a reset. The barrier closes the path
  through the protocol, not the machine.
- **The network.** A `ws://` path that is not private can change the payload in flight; the signature binds
  the answer, so such a change is refused, but the nonce and request stay visible.
- **Bypass.** In `bypassPermissions` (#3427) most requests are never asked, so there is nothing to approve.

## The CLI

`flightdeckd approve` of a high-risk request sends no allow, prints that the person must approve it in the app,
and exits 1 (the CLI never sends `updatedPermissions`, so risk is the only case it meets). It reads the risk from the request, as `requests` does;
the daemon refuses a raw connection the same way, so the CLI is only polite. `--hold` stays accepted and is no
longer a proof: the text of `refusalLine` (`answer-view.ts`) that says `--hold` is for a person who means to
allow is removed (in `answer-view.ts`). Below high risk, `approve` works as today. `flightdeckd approve` sends no
`updatedPermissions`.

## The app (what shipped, #3439)

- **Keys.** One P-256 key per host, kept in the OS credential store under the service
  `flightdeck-approval` and named by the host's daemon id (`host.info.daemonId`). The webview can create,
  delete and ask to sign with it, never read it (`approval_key_*`, `approval_sign` in `src-tauri`).
- **Signing.** A Rust command shows a native dialog built from the text being signed; `Err("declined")` on
  cancel, else it signs. A decline is silent in the app: the request stays open. This is a reduction, not a
  proof: a compromised renderer can still ask for a dialog the person may approve by habit.
- **When.** `needsApprovalProof(risk, updatedPermissions)` in the protocol is the one predicate the host and
  the app read. A deny never needs a proof. The queue's allow and the card's allow both go through it.
- **Panel.** The host page's **Approving devices** lists the keys (`approval.list`), enrolls this device
  with the terminal's code (first enroll only), revokes a key and drops the local key. The panel is shown only
  for a host that announces `approval-proof`, on an app that can hold a key.
- **Deferred.** `approval.watch` and the enrolled/revoked notices: the app reads the list on connect and
  flags a key it did not create. Adding a second device from the app alone (`enroll-add` needs a signer key
  on another device) is not built.

## Order of work

1. This record, with `security-reviewer` on the changes, before any code.
2. Protocol and daemon: the daemon id, `approval.*` commands, the store, challenge, check, both paths
   (`test(permissions)` first).
3. The app: enroll, sign on the press (`tauri-rust-reviewer`), device list, the unprotected notice; the CLI exit 1.
4. `flightdeckd approvers` commands and both manuals (`flightdeckd-commands.md`, pt-BR twin).
