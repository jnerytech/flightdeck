# Saving vault rules that loosen a secret's use takes the device proof (issue #3754)

Parent: #3423. Follows `2026-11-20-vault-approve-proof.md` and `2026-11-21-snippet-trust-proof.md`.

## Decision

`vault.rules.set` joins `PROOF_COMMANDS` and takes an optional `proof`. A rule with `decision: "allow"` or
`outsideWindow: "allow"` lets the host approve a use of a secret with no person. So with a device enrolled, a set that
carries such a rule runs only with that device's signed proof over `{ secretId, tags, rules }`. A set whose rules are
all `ask` or `deny`, and an empty set, needs no proof: tightening is never held up. With no device enrolled nothing
changes. Before this, a session on the host could save an `allow` rule for a secret and then use it with no person.

- **One definition of "loosens".** `ruleLoosens` in `packages/protocol/src/approval.ts` decides it. The host's own
  ceiling in `vault/domain/rules.ts` (`loosens`) calls it, so the proof gate and the ceiling never disagree and there
  is no second parser (condition 2 of the grant).
- **Its own feature.** The host announces `FEATURE_APPROVAL_VAULT_RULES` (`approval-vault-rules`). The schema is strict,
  so a host from before it rejects a `proof` it does not know: the app signs only when the feature is announced, and
  the devices panel shows `approvalDevices.vaultRulesUnchecked` for a host that keeps rules but does not announce it.
- **Fail closed.** A set that carries an `allow` rule and no proof is refused with `approval_proof_required` and nothing
  is saved. The app shows the refusal. It never falls back to a looser or older set, and it never retries in a loop.
- **The signer shows counts, not bodies.** The Rust signer requires the exact payload shape, canonical key order
  included, and shows the secret id, the rule count, how many allow and how many allow outside the window, and a
  production flag (the `prod` tag). It cannot show every rule body in a system dialog. The signed digest still covers
  every field, so the host refuses a set that differs by one character from the one signed. A shared vector in the
  protocol and the Rust tests fixes the bytes both hash.
- **CLI.** There is no `flightdeckd` verb that sets rules (`docs/cli-parity.json` keeps `vault.rules.set` as an app
  action), so the terminal gains no way around the proof.

## Gaps, stated plainly

- **Restart and scope push never sign.** The proof is asked only when a person presses **Save rules**. Two app
  paths send rules to a host without a person: the resync when the app connects, and the push when a secret's
  allowed hosts change (the scope push). They never open a signing window. On a host with a device enrolled, a set
  that carries an `allow` rule sent by either path is refused, and the app shows `vaultRulesUi.notResent` (or, for a
  rollback, `vaultRulesUi.notPutBack`). The host then keeps the rules it already held. That is not always the
  stricter side: when a scope push *narrows* a secret's reach, the rules the host keeps are the wider ones, so the
  old scope stays live until the person saves the rules again with a signature. A retry loop that would open
  signing windows with nobody there was rejected. After a daemon restart the same holds: `allow` rules are not
  restored until the next signed save.
- **A change of tags is not gated.** The proof covers `tags` (they are signed), but a set whose rules all ask or
  deny, with the `prod` tag removed, needs none. A secret that stops being production stops needing the held
  approval of #3452. The rule of this issue is "an allow", so this is left for a follow-up.
- **Removing a deny is not gated.** The gate reads the new set only, not the held one. Replacing `deny` rules by an
  empty set lets the secret fall back to the defaults, and an `ask` rule with `once: "session"` loosens a hold.
  Comparing with the held rules is a follow-up.
- **The dialog shows counts.** It names the secret, the number of rules, how many allow and how many allow outside
  the window, and whether the secret is a production one (`prod`, `producao`, `produção`, any case, as the host's
  `isProdTag`). It does not list rule bodies; the signed digest covers every field.
