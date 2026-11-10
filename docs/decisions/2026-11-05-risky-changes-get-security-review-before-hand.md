# Risky changes get a security review before the hand-off (issue #273)

- **Why.** On 2026-11-05 six reviews found high findings after the hand-off (keep-awake,
  worktrees, resources, logs, trust, assistant). The review now comes before it.
- **The gate** (scripts/lib/security-gate.ts, run by `handoff:check`) reads the added lines of the
  changed code files (never a test, a fixture or a document) since the audit base or `--base`. A
  file is risky when they spawn or kill a process (any `spawn…(`, `exec…(`, `.kill(`), delete
  (`rm(`, `unlink(`, `rm -rf`), name a secret (token, secret, password, credential, API key) or a
  permission (`chmod`, `chown`, permission, `allowedNetworks`), or when its path is in the vault or
  pairing code, or when they open a listener or an outbound call (`Bun.serve`, `fetch(`, a
  WebSocket, `.listen(`). A spawn is also `cp.exec(`, `child_process`, `Bun.$`, `fork(`, `execa(`
  or `new Worker`, and in Rust and Python `Command::new`, `std::process`, `subprocess.`,
  `os.system`; deletes and listeners have their Rust and Python forms too. A line that is only a
  comment and nothing else does not count; a line is never cut, so one with any code is read whole
  (a glob's `*/` or comment marks in a string cannot hide what it does; `#` is a comment only in
  `.sh`, `.py` and `.ps1`, since in TypeScript it is a private field). Code is `.[cm]?[jt]sx?`,
  `.rs`, `.sh`, `.ps1` and `.py`. A mode change counts as a permission change. Some paths are risky
  whatever they add: the vault and pairing code, the Tauri shell's capabilities and
  `tauri*.conf.json` (CSP, scopes), `.github/workflows/`, and the files whose contents run as code
  (`package.json`, `Cargo.toml`, `build.rs`, `bunfig*.toml`, `.claude/settings*.json`,
  `.claude/hooks/`), and the guards themselves (the gate, the hook rules, the TDD audit, the
  hand-off check, the hook runner, `bun run pr`, the security-reviewer agent, `.github/actions/`); a pure rename into one counts too. Left as known limits: a
  risky file moved by rename from a test folder is read by its edited lines only, a mode change on
  a file with no code extension is not seen, and every `package.json` change asks for a review. Patterns, not a parser: they err toward asking for a review.
- **It fails closed** (the OpenCode review on #279): a `git diff` or `git log` that fails (an error,
  an output past 64 MB), or a `--base` that is not a commit, stamps `security=unknown`, never `0`.
  The diff forces `--src-prefix=a/ --dst-prefix=b/` (a user's `diff.noprefix` or
  `diff.mnemonicPrefix` would change the headers) with no external diff or text conversion. The
  diff's file headers are read only before a file's first hunk (an added line can look like one),
  names come unquoted, and a merge counts by the files it edited itself. The log is in topological
  order, so "after" follows the history, not the dates, a folded trailer reads as one line, and a
  user's `log.showSignature` adds nothing to it (`--no-show-signature`).
  Risky files that no commit of the log touches need a review all the same. `--verify` refuses a
  stamp with no `security=` or no `ci=`, so a stamp from before the gate does not pass. It is a guard against slips,
  not a security boundary: the trailer is the session's own word that the review ran. A name git
  still quotes (one with a quote, a backslash or a control character) is skipped.
- **The verdict is a commit trailer,** `Security-Reviewed: <summary>`, on a commit at or after the
  last commit that touched a risky file (an empty `chore(security)` commit is enough). A later
  risky commit needs a new review. A trailer lives with the branch, so `--verify` and any receiver
  see it; a line in a message would not. The stamp says `security=0`, `unreviewed` or `unknown`
  (no base), and only `0` vouches.
- **The OpenCode review on `pr open`** is the coordinator's tooling: `open` runs the command in
  `FLIGHTDECK_PR_OPENED` with the PR's number, branch and base. The command comes from the
  session's own environment, never from the repository: words split on spaces, or a JSON array of
  strings for a path with spaces (Windows), with no shell. It runs bounded
  (scripts/lib/bounded-run.ts): its output ignored, since it inherits the environment and what it
  prints may hold a token, so the failure line says only the exit code (124 past the deadline, 127
  when it could not start). Past two minutes its whole process group is killed (its tree, with
  `taskkill /T`, on Windows; an orphan whose parent already died escapes that walk). A hook that
  fails, cannot start or times out only prints that line: the PR is open either way. On Windows a
  bare program name may resolve in the current folder first: give the hook an absolute path. Its program is found by Bun's own PATH lookup, not `whichOnPath`: the environment, and the
  PATH with it, are the session's own. The number, branch and base come last, as positional
  arguments: a hook script must not read them as options.
