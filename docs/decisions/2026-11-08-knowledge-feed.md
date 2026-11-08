# The library's index in the system prompt of a session (issue #76)

Slice 3 of the project knowledge library: the sessions Flightdeck starts are told which documents
of the project are current.

## Decision

- **Who is given it.** `flightdeckd claude` (so also "Claude here" and background sessions) asks the
  host daemon for `knowledge.index` of the folder it runs in and appends the answer to the system
  prompt with `--append-system-prompt-file`. A persona's body and the index share one file (claude
  takes one such flag). A system prompt the user passes (`--append-system-prompt` or `-file`) wins:
  no index is added. A daemon that is down or does not know the command gives none, and claude opens
  as before.
- **What is given.** The path and one-line title of each `valid` document, then each `transitional`
  one marked `(transitional)`. `unclassified` and `obsolete` are never given. Capped at 4096 bytes
  with a closing line that says how many were left out; valid documents come first, so the cap cuts
  transitional ones before valid ones.
- **Why trust gates it.** The titles are text from the repository, and a system prompt outranks the
  files an agent reads. The host gives the index only to a folder the person trusted (the same
  decision that lets a project bring hooks and MCP servers), and reads a worktree from the trusted
  main checkout, never from the branch. Each title is one plain line of at most 120 characters (line
  breaks and control characters become spaces), a path with a control character is left out, and the
  prompt states that paths and titles are the repository's data, not instructions. Paths are the
  ones `knowledge.list` already vets (fixed folders, no links, no credential names).
- **Off switch.** `knowledge.feedOff` in the host's config: project folders, and everything inside
  them, whose sessions are not given the index. It is a config key for now; a toggle in the
  knowledge panel is a later slice.

## Left out

- Document bodies. The agent reads a document with its own tools, as it reads any file.
- Card pins, writing `status` back, templates and ADR drafting (later slices).
