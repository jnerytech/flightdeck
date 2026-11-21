# Trusting a project's snippet file takes the device proof (issue #3647)

Parent: #3423. Follows `2026-11-20-marketplace-command-proof.md` and `2026-11-21-approval-proof-scope.md`.

## Decision

`snippets.trust` joins `PROOF_COMMANDS` and takes an optional `proof`. Trusting a project's
`.flightdeck/snippets.yaml` lets the commands in it run in terminals, so with a device enrolled the trust runs only
with that device's signed proof over `{ projectPath, hash }`. With no device enrolled nothing changes. Before this,
a session on the host could trust its own project's file with `flightdeckd snippet trust`, with no person.

- **Its own feature.** The host announces `FEATURE_APPROVAL_SNIPPETS` (`approval-snippets`) when it keeps snippets and
  can check proofs. The schema is strict, so a host from before it rejects a `proof` it does not know: the app signs
  only when the feature is announced, and the devices panel shows `approvalDevices.snippetsUnchecked` for a host
  that keeps snippets but does not announce it.
- **Order of checks.** The host finds the file and compares the hash first (`snippet_file_changed`), checks the folder
  and the proof last, just before it records the trust. A request for a file that changed does not spend the challenge.
  No field narrows the request, so every payload needs the proof.
- **The folder is the folder the host trusts.** The host resolves the folder to a real path inside the allowed roots.
  With a device enrolled, a folder that resolves to another one (a link, a relative path) is refused with the real
  one in the existing `trust_path_differs` reason, so the person never signs one folder while another is trusted.
- **The hash is signed and shown.** The signer requires exactly `projectPath` and `hash`, the hash as 64 lowercase
  hex characters (what the host makes), so it cannot pad the dialog. The dialog shows the first 12 characters, the
  folder last on a line of its own. A shared vector in the protocol and the Rust tests fixes the bytes both hash.
- **CLI.** `flightdeckd snippet trust` sends no proof, so on a host with a device it is refused with
  `approval_proof_required` and says the person confirms it in the app.

## Not in this slice

`snippets.use` and `terminal.write` keep the token model: a trusted file is what lets a command run, and this
slice guards the trust, not each use.
