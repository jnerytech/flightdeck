# The harness apply binds each proposal by a digest, and leaves trust alone (issue #75)

## Context

Slice S4a of #75 adds `project.harness.apply`, which writes what `project.harness.preview` proposed
(docs/decisions/2026-11-07-harness-preview.md). fd-coordinator accepted S3 on two conditions:

1. The write is a pure merge. It never changes or removes an existing key, and a key in the way is
   left as it is and reported.
2. The hash checked at write time must match the file as previewed. On a mismatch, apply refuses with
   a code and asks for a new preview.

A file hash alone does not bind what is written. The formatter hook's command and the commands in
the new Markdown files come from the detected stack (`package.json`, lockfiles). A pull between the
preview and the apply can change them while `settings.json` stays byte for byte the same. The daemon
would then write a command the person never saw.

## Decision

- **A digest per proposal.**
  - The preview's settings proposal gains `digest`: the sha256 of its file hash plus its hooks, deny
    rules and conflicts.
  - Each new file gains `digest`: the sha256 of its content.
  - The file hash is inside the settings digest, so condition 2 holds.
- **`project.harness.apply {path, parts, digests, confirm}`.**
  - The daemon makes the proposals again from the files as they are now. It never takes content from
    the app.
  - The set of `digests` must equal exactly the proposals now: same paths, same digests. A missing,
    extra or different digest refuses the whole call with `harness_stale` ("preview again"), and
    nothing is written.
  - The answer is `{written}`: the paths written, the settings first.
- **The merge (condition 1).**
  - Hooks are appended to `hooks.<event>`, and deny rules to `permissions.deny`.
  - A key that holds another shape is a conflict in the preview, and gets nothing.
  - A settings proposal with only conflicts writes nothing.
  - The file is written back with its own indent and final newline. When that changes its layout
    (`reformats`), apply still writes it: the preview showed it and the person confirmed.
- **Where it writes.**
  - Every check happens before any write.
  - The project path must still resolve to itself: the server resolved it inside the allowed roots.
  - `settings.json` is walked again with no link allowed anywhere on the path. It is then opened with
    `O_NOFOLLOW` (where the platform has it), and the handle must be the same file (device and inode,
    compared as bigints) the walk found, with one name only. A hard link would write a file elsewhere
    through the same inode. Its bytes are hashed from that handle and written back through it.
  - A new file is created folder by folder: a link on the way is refused. It is opened with
    `O_CREAT | O_EXCL`, so a file that appeared since the check is not overwritten. After the open,
    its folder must still resolve to itself, or nothing is written into it.
  - New files are written before the settings, so such a late file refuses before the settings
    change.
  - A worktree's path is written where the path says. A session in a worktree reads its
    configuration from the trusted main checkout, so the change takes effect there once it is
    merged. S4b says so.
- **Guards.**
  - Feature `harnessApply`.
  - A near connection only (loopback or Tailscale), like `project.trust.set`: a hook runs its
    command in every session of a trusted project.
  - `confirm: true`, else `harness_confirm`.
- **Trust is left alone.** Trust records are per folder, with no fingerprint of the configuration.
  Apply neither grants nor revokes trust. The new hooks load only in a project the person already
  trusts, and S4b says so before the confirm.

## Alternatives discarded

- **The file hash alone, as S3 planned.** It misses a change of the stack, which changes the hook
  command and the Markdown files.
- **Write to a temporary file and rename it.** It changes the file's inode and mode, and guards
  nothing more than the handle's identity check does.
- **Ask for trust again on every apply.** It needs a configuration fingerprint in the trust records,
  which they do not have. That is its own change, if it is wanted.
- **Refuse a write that reformats.** The person already sees `reformats` in the preview, and the
  merge keeps every value.

## Consequences

- On Windows, `O_NOFOLLOW` is not defined. There, the walk and the device-and-inode check stand
  alone. The residual race is a folder on the path swapped for a link between the walk and the open,
  pointing at a different file: the identity check refuses it. Pointing at the same file writes
  where the person meant.
- Node has no `openat`, so a folder swapped between the last check and the open can still place an
  empty new file outside the project. The check after the open refuses before any content is
  written, and `O_EXCL` means the file is one this call made.
- The settings are written as truncate, then write, through the handle. An edit made by someone else
  between the read and the write is lost, and a crash in between leaves the file short. The window is
  the length of one write, during an apply the person started.
- An apply that refuses with `harness_stale` after a late file appeared may have created the new
  files before it. They are template files that were missing, and nothing of the person's changes.
- S4b, the app's confirm step, shows the formatter command and says it runs the project's own
  script. It calls the deny rules best-effort and says the hooks load only in a trusted project.
