# Adding a plugin marketplace takes the device proof (issue #3516)

Parent: #3423. Follows `2026-11-20-plugins-command-proof.md`, which left `plugins.marketplaceAdd` for this slice.

## Decision

`plugins.marketplaceAdd` joins `PROOF_COMMANDS` and takes an optional `proof`. A marketplace is where plugins come
from, and a plugin runs code in every session of the host, so with a device enrolled the add runs only with that
device's signed proof over the whole request. With no device enrolled nothing changes.

- **Its own feature.** The host announces the check with `FEATURE_APPROVAL_MARKETPLACE` (`approval-marketplace`), not
  `approval-plugins`. A host that announced the plugins feature without guarding this command would reject the
  `proof` the app sent, because the schema is strict. The app signs only when the host announces the feature, and
  the devices panel shows a separate notice (`approvalDevices.marketplaceUnchecked`) for a host that does not.
- **Order of checks.** The host validates the source and the `confirm` first (`marketplace_add_confirm`), checks the
  proof last, just before the change. A refused request does not spend the challenge. No payload field narrows the
  request, so every payload needs the proof (no `NARROWING_FIELD`). `confirm` must be present: the gate refuses a
  proof over a request that left it out.
- **`confirm` is a boolean.** It is the only signed field that is not text. The canonical JSON carries the literal
  `true`, the Rust signer requires exactly the boolean `true`, and a shared vector in the protocol and the Rust tests
  fixes the bytes both languages hash.
- **The source rule.** The dialog shows the source, so the signer signs only a source it can show whole and a person
  can read at one glance. It accepts three forms: `owner/repo` (two plain names), `https://host/path` (plain names
  only: no user, `@`, port, query, fragment or `%` escape, and no `.` or `..` segment), and an absolute folder path
  with the rules of every other folder the signer shows. It refuses anything else, so it fails closed: `http://`,
  `git@host:owner/repo`, `github:owner/repo`, a relative path and a name that starts with `-`.
- **A source the signer refuses has no path while a key is enrolled.** The CLI accepts those forms, but with a key
  enrolled the plain `flightdeckd plugins marketplace-add` sends no proof and is refused with `proofRequired`, as for
  the other guarded commands. The person adds the marketplace in one of the three forms, in the app. The app says
  so: the signing error is followed by `pluginsUi.addSigningHint`, which names the three forms.
- **The app.** The page signs first. A no in the system's dialog, or a source the signer refuses, sends nothing and
  keeps what the person typed. The signer's dialog names the source, the scope (`for you` when none) and says that
  the marketplace's plugins run code.

## Not in this slice

A folder source is signed as typed. The host does not resolve it to an allowed root before the proof, as
`plugins.install` does for `dir`, so the person signs the path the dialog shows and the host adds what it names.
Resolving it first (and refusing with the real path, as `plugin_path_differs` does) follows if needed.
