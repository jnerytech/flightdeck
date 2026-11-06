# One list of secret and control paths (issue #449)

`credential()` (the classifier), `CREDENTIAL_READS` (OpenCode's read rules), the credential-name
check of the worktrees and the rule check's `SENSITIVE`/`CONTROL` lists were four lists that drifted
(issues #435, #439). They now derive from `apps/daemon/src/permissions/sensitive-paths.ts`:
`SECRET_PREFIXES`, `SECRET_NAMES`, `SECRET_EXTENSIONS`, `SECRET_DIRS`, `SECRET_PAIRS` and the
control lists `CONTROL_DIRS`, `CONTROL_NAMES`, `CONTROL_PAIRS`. `credential()` and `isControl()` are
functions of those lists; `credentialReadGlobs()` builds OpenCode's globs from them; the worktree
check calls `credential()` and keeps only its hint regex (`credential|secret|token|password|api key`)
for names no list can know.

Consequences: OpenCode now asks before reading every name the classifier calls a secret (`*.env`
stays; `.npmrc`, `.kube/*`, key stores, histories are new), a worktree with an ignored `.boto`,
`.pgpass`, `wallet.dat`, a history or a `*.ppk`, `*.tfstate` blocks removal as `.env` does, and any
file ending in `.env` (`prod.env`) is a credential for the classifier too, as it already was for
OpenCode. OpenCode's globs are case-sensitive and the classifier's are not: a capitalised name is
asked about by Flightdeck's own check, not by OpenCode's rule.

`apps/daemon/test/secret-paths-drift.test.ts` fails when the classifier and the globs disagree on a
hand-written list of secret paths, in both directions.
