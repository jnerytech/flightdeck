# `project harness-apply` and `harness-commit` get a CLI verb; `project.trust.set` stays in the app (issue #3515)

Parent: #3423. Builds on the device proof of #3439 and on the command gate of #3453 and #3507.

## Decision

`flightdeckd project harness-apply <folder> --parts <list> --digests <preview.json> [--template <id>] [--reformat] --confirm`
and `flightdeckd project harness-commit <folder> --digests <applied.json> --confirm` call `project.harness.apply` and
`project.harness.commit`. Both take `--json` and the exit codes of the other verbs: 0 done, 1 refused, 2 no daemon.

`project.trust.set` is not part of this slice. #3453 decided that trust is a permission decision and stays app-only,
so it keeps its empty `docs/cli-parity.json` row.

## How it works

- The digests come from a saved answer, never from a flag. `harness-apply` reads the digests of a saved
  `harness-preview --json`; `harness-commit` reads those of a saved `harness-apply --json`. The file is checked
  against the protocol's own schemas, so a wrong file is refused before any call, and a file with more than 17
  digests is refused the way the protocol refuses it.
- The host makes the proposals again and refuses with `harness_stale` when one differs from its digest. This is the
  only guard on `--parts` and `--template`: the saved preview does not carry them, so the CLI cannot compare them.
- The CLI sends `confirm: true` only because `--confirm` was typed. A typed flag proves nothing about a person.
- A write may have happened when the daemon goes silent, so the run reports "may or may not have happened" (exit 2).
- `harness_reformat` is told in CLI words (`--reformat`). `approval_proof_required` is told as "do it in the app":
  a terminal cannot sign for a device, and this is the same answer `autoapprove resume` gives.

## What actually guards it

1. The device proof. With a key enrolled, `project.harness.apply` is refused without a signature, and a terminal
   cannot give one. `harness-commit` writes nothing new to the working tree and takes no proof.
2. The risk rule. A session that runs either verb from its shell is `high`, so the app asks the person first. Without
   it, a session could plant a hook with `harness-apply` and commit it with `harness-commit`.

Without a key enrolled the typed `--confirm` is all a person at a terminal has. That is the same state as every other
`--confirm` verb of the CLI.

## Not done

`project.trust.set` (above). The left-out fields of #3515 (`issues`, `personaByColumn`, `contractByColumn`,
`roiSignals`) belong to other verbs and are not touched here.
