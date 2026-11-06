# A session's project is its launch folder's, not the hook's current folder (issue #583)

## Context

The Sessions page filed a session started from the terminal in project B under project A, and B's group lost it. The daemon's terminal record (`external_sessions`) took its `project_key` from the `cwd` of every hook event. Claude Code's hook `cwd` is the session's current folder, so it moves when the session works in a sibling folder. The hub preferred the terminal row over the history row of the same `claudeSessionId`, so the transcript's project (B, the first `cwd` the history indexer keeps) disappeared.

## Decision

- The daemon sets `project_key` once, from the first `cwd` it sees: the launch folder, the one Claude Code files the transcript under. `cwd` keeps tracking the current folder.
- The app files a terminal row under the project and folder of the history row with the same `claudeSessionId` when there is one, so records written before this fix land right too.
- The "terminal" origin is a chip on the row (`origin-chip`), not a label in the group header.

## Discarded alternatives

- **Decode the project from `transcript_path`'s folder name.** Claude Code encodes the path lossily (`/` and `.` both become `-`), so the folder cannot be read back. The history indexer already reads the real `cwd` from the transcript's lines.
- **Prefer the history row over the terminal row in the hub.** That would lose the live state, the controllable badge and the approvals the terminal row carries.

## Consequences

- A daemon that first sees a session mid-way (a restart after the session moved) records the folder it sees then. The app's history lookup corrects the grouping once the transcript is indexed.
