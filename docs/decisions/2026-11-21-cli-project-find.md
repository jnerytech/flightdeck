# The project scan and clone from a shell (issue #3737)

Part of the CLI-first rule (`2026-11-19-cli-first.md`, #3423).

- `project scan [--depth <1-3>]` asks `projects.scan`: the git repositories inside the allowed folders, bounded in depth
  and count. It reads only, so it has no risk rule. When the host stopped at its cap the CLI says so.
- `project clone <url> --root <folder> [--name <text>] --confirm` asks `projects.clone`. The address (up to 2048
  characters) and the name (up to 100) are checked before the CLI connects. The host decides which addresses and
  folders it accepts; its refusal reason is printed and the exit code is 1. The CLI makes no new check of its own.
- `--confirm` is a typed flag, the caller's own word, as for every write verb here. A run of `git` on an address the
  caller gave, writing a folder on the host, is the kind of call a person should see, so a session that runs
  `project clone` from its shell is `high` (the rule lives in `permissions/domain/project-risk.ts`). A clone that got no
  answer says it may or may not have happened.
- `project clone` does not run `project add` on the new folder: the app does it in two steps, and `project add <path>`
  exists. Decided without the person's input, as the issue proposed.
- `roots.add` is `appOnly` in the parity table: with a device enrolled the host asks for a signed proof a terminal
  cannot give (#3453), and an allowed folder is what every other path check trusts, so a typed flag must not add one.
  A later slice may add a verb for a host with no device enrolled, with its own security review.
- `--depth` and `--root` take a value, so the shell rules' list of options that take one holds them too (a test keeps
  that list equal to the parser's).