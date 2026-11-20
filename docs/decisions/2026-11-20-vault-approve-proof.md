# A prod or high-risk secret use is approved with the device's proof (issue #3452)

## The gap

`vault.approve` took `via` and `heldMs` from the caller (#3439 left it out). A session runs as the same OS
user as `flightdeckd`, so it can read the token, open a connection and send `vault.approve` with
`via: "app"` and `heldMs: 2000` for its own request, then deliver the secret to itself. The 2 s hold
(`HOLD_MS`) protects nothing against a caller who writes the number.

## Decision (fd-coordinator, 2026-11-20)

For a request that **needs the hold** (a production tag, a high-risk rule, a `run_with_secret`), on a host with
an enrolled device, the signed proof of #3439 replaces `via` and `heldMs`. A request that needs no hold is
unchanged, and so is a host with no enrolled device (the hold stays, and the host page says "Protection is
off").

- **Message.** `["flightdeck/vault-approve/v1", keyId, daemonId, requestId, nonce, scope]`, canonical JSON
  (`vaultApproveMessage`, `packages/protocol`). The request id and the scope approved ("once" or "session",
  the payload's, "once" when absent) are signed, so a proof made for one request or one scope is no proof of
  another. A new tag, so a signature of a permission allow can never stand for a secret use, and the device
  names the secret use in its own dialog (`Kind::VaultApprove` in the signer).
- **Nonce.** The same book and the purpose "approve", bound to the vault request id (the tag keeps the two
  domains apart). `approval.challenge` is answered for a pending vault request that asks, needs the hold and is
  not approved yet (`Actions.needsProof`); a request that needs no hold gets no nonce.
- **Check.** `SecretRequests.approve`, after the rules that need no proof (the tray, a risky session approval),
  calls `ApprovalGate.checkVault`: key enrolled, signature verified, only then the nonce spent. A request
  refused for another reason burns no nonce, and a forged proof burns none. `heldMs` is not read when a
  device is enrolled. Refusals: `approval_proof_required` (missing, unknown key, bad signature, a used nonce
  or one for another request, another scope) and `approval_challenge_expired` (past 60 s). The request stays
  open and the delivery still fails with `action_needs_approval`.
- **Feature.** `approval-vault`, announced when the host has approvers and the actions service. The app asks
  for a proof only on a host that announces it.
- **App.** Approve of a request that needs the hold asks for the challenge when the person presses Approve,
  and the system's dialog confirms; Cancel denies the request and delivers nothing.

## What an older app does against an enrolled host

An app without this change sends `via` and `heldMs` and no proof. For a request that needs the hold the host
refuses it with `approval_proof_required`, nothing is delivered, and the run waits for its deadline or a deny.
The person has to update the app, or `fd approvers reset` at the host terminal to go back to the hold. A request
that needs no hold still works. A new app against a host without `approval-vault` sends the old fields.

## Left as it was

No-hold requests stay on the caller's word: a session can approve its own low-risk secret use. #3453 covers the
other commands that need a proof.
