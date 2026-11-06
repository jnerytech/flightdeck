# Saved path rules are checked against the CLI's matcher, and a folder covers its subtree (issue #395)

`ruleLevel` (#384, `apps/daemon/src/permissions/rule-risk.ts`) judges a permission rule before it
is saved: the rule must not cover a call riskier than the request it came from. It read a rule the
way we thought Claude Code matches it. Issue #395 asked for a check against the real matcher.

- **The contract source.** Claude Code documents Read and Edit rules as gitignore patterns. The
  installed CLI (2.1.319) is a native binary, but its bundled JavaScript carries the `ignore`
  package: its error texts are in the binary. So `ignore` (a dev dependency, pinned exactly) stands
  in for the CLI's matcher in `apps/daemon/test/rule-risk-contract.test.ts`. For each rule
  `ruleLevel` accepts, every probe path the matcher lets the rule cover must rate no higher with
  the daemon's own `RiskClassifier`. It runs case-insensitive (Windows, and the library's default)
  and case-sensitive. The version the CLI bundles cannot be read from the binary.
- **What the contract does not prove.** How the CLI turns `//abs`, `~/`, `/` (the project root)
  and a bare path into a root and a relative path. The test uses absolute rules matched from `/`,
  the one form whose root is plain.
- **What it found.** A rule that names a folder (`Read(//proj/src)`, `Edit(src/)`, and the app's
  own default rule for Grep and Glob, whose `path` is a folder) was rated as the folder alone. The
  matcher covers everything under it, `src/.env` and `src/.ssh/id_rsa` included.
- **The fix: what is on disk decides.** `ruleLevel` takes a path kind (folder, file or missing).
  Only a file found on disk keeps the level of the path itself, so "Always in this project" still
  saves the exact file a request read or edited. A folder, a path that ends with a slash, and a
  path that is not there yet are rated with their subtree, so a credential can be inside and the
  rule is refused. A missing path counts as a folder because `mkdir` after the rule is saved would
  make it one (security review). The `permission.respond` handler looks the exact paths up first,
  only for an allow of an open request: an async `stat` from the request's folder, `~/` from the
  home, at most 32 paths, never a network path (`//host/share`), and 2 s at most each. Any path
  not looked up counts as a folder: past the cap, after a time-out, or when it cannot be looked up
  (no access, a bad name). That refuses the rule.
- **Rejected.**
  - Guessing from the name: `Makefile` looks like a folder, `conf.d` like a file.
  - Refusing every exact rule: it would break the app's default rule.
- **What stays open.**
  - A file that is replaced by a folder after its rule is saved. That takes an approved delete and
    an approved write, the same class as a symlink made by an approved Bash call. The follow-up
    `realpath` work rides on the same injected lookup.
  - A project-relative rule (`/src`) is looked up from the request's folder, while the CLI reads
    it from the project root. When the two differ, the lookup most often finds nothing there, and
    that refuses the rule.
  - A new file cannot get an "Always" rule before it exists: allow it once, and save the rule the
    next time.
  - Bash prefix rules have no matcher library to test against, and a live probe of the CLI costs
    quota, so CI has no contract for them. `OPEN_SHELL` and `SHELL_SYNTAX` refuse every prefix
    form the issue lists (`;`, `$(...)`, a redirect, and any program outside the short list).
  - The app saying why a rule was refused is UI work: #524.
