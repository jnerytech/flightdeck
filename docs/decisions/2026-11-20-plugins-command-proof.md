# Installing and updating a plugin take the device proof (issue #3516)

Parent: #3423. Builds on the command gate of #3453 and the record of #3507 (`2026-11-20-host-command-proof.md`).

## Decision

`plugins.install` and `plugins.update` join `PROOF_COMMANDS`. A plugin runs code in every session of the host, so
with a device enrolled both run only with that device's signed proof over the whole request, and the host announces
the check with `FEATURE_APPROVAL_PLUGINS` (`approval-plugins`). With no device enrolled nothing changes.

- **Order of checks.** The host refuses a content hash that is not the one it would fetch (`plugin_content_changed`),
  a pinned plugin and an unchanged update first, and checks the proof last, just before the change. A refusal before
  the proof does not spend the challenge. A missing proof and a wrong one both give `approval_proof_required`.
- **The folder is the folder signed.** `plugins.install` with `dir` resolves the folder to an allowed root. When a
  device is enrolled and the resolved folder is not the one in the payload, the host refuses with
  `plugin_path_differs` and the folder it is, before any proof, so the person never signs one folder and installs
  another.
- **Two dialogs.** When the marketplace declares a command, the first call returns `needs-command-confirmation` and
  the re-send carries `acceptCommand`. Each call is a request of its own, so each is signed: the person sees the
  system's dialog twice. A proof covers every field, so a proof signed without `acceptCommand` does not carry one.
- **The dialog.** It names the plugin, or the folder it comes from, the scope and the host, and says that a plugin
  runs code. `confirmHash` and `acceptCommand` are signed but not shown: they are plain tokens the host makes, and
  what the plugin contains is the preview the person has just read in the app. The Rust signer refuses a payload with
  a field it does not know, a plugin that is not a plain id, a folder it cannot show whole and a scope that is not
  `user`, `project` or `local`.
- **The CLI.** As for the other guarded commands, with a key enrolled the plain `flightdeckd plugins install` and
  `update` send no proof and are refused with `proofRequired`: the person uses the app.
- **The app.** The install and update dialogs sign first. A no in the system's dialog sends nothing and shows no
  error. A host that does not announce the feature gets the plain payload, and its page shows a notice
  (`approvalDevices.pluginsUnchecked`).

## Not in this slice

`plugins.marketplaceAdd` fetches code from a source the person types and needs a rule for the source the dialog can
show; it follows in its own slice of #3516.
