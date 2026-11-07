# A project's files and a search over a repository (issue #797)

## Context

The context panel (#117) shows a project's files beside the board and searches them by name and by
content. The daemon listed and read files of a session, a card's worktree or a terminal's folder,
one folder at a time. It had no target for a project's own checkout and no search over a whole tree.

## Decision

- **`project:<id>` is a read-only target.**
  - The daemon resolves it from the project record. It never takes a path from the app.
  - The project's path must be inside `allowedRoots`, like a card's.
  - `file.list`, `file.read`, `file.search` and `changes.get`/`changes.watch` take it. `file.write` and the revert refuse it (`review_target_invalid`), the way they refuse a terminal. The panel shows files; edits go through a session or a card.
- **`file.search` only searches a repository inside `allowedRoots`:** a session, card or project target. It refuses a terminal's folder, which can be the person's home, and a session that ran anywhere else. Every search first checks with git that the folder is a repository, since `rg` would search any folder.
- **Search by name** runs `git ls-files --cached --others --exclude-standard`, so `.gitignore` holds. It keeps a case-insensitive substring match on the path.
- **Search by content** runs `rg` when the host has it (`whichOnPath`), and `git grep` otherwise.
  - Both use fixed strings only, ignore case, take at most 5 matches per file and skip binary files. The query always comes after `--` or `-e`.
  - `git grep` gets no `--max-count`, which gits before 2.38 refuse. The daemon caps the lines of each file itself.
  - `rg` runs with `--no-config`: a config file named in the environment could add `--pre` (which runs a program) or `--search-zip`.
- **Limits:**
  - at most 200 matches (default 100);
  - a cap on the bytes read from the tool;
  - 5 seconds, after which the process tree is killed.

  Past any of them the result says `truncated`.
- **What a match may carry:**
  - Its path must resolve inside the root and outside `.git`, or it is dropped.
  - A credential file never sends a line of its content. A name match on one is marked `secret`. A link counts as what it points to.
  - A line is cut to 200 characters.

## Discarded alternatives

- **A regex from the app:** a pattern can be slow by construction, and both tools read flags from it. Fixed strings cover the panel's use.
- **Walking the tree in the daemon:**
  - it reimplements `.gitignore`;
  - it is slower than `rg` on large trees;
  - it would still need a time limit.
- **`rg --hidden`:** it would search dotfiles such as `.env` that `rg` skips by default, reading them only to drop the credential matches.
- **A writable project target:** the panel does not edit. Keeping it read-only keeps the primary checkout out of reach of the write path.

## Consequences

- `rg` skips hidden files. `git grep` searches tracked dotfiles (`.github/`, `.eslintrc`). The same query can therefore find a little more on a host without `rg`.
- A host without `git` cannot search a repository by name. The search then refuses with the git reason, as `changes.get` does.
- The protocol surface baseline is refreshed at release (`scripts/protocol-surface.ts --write`), not on this branch.
