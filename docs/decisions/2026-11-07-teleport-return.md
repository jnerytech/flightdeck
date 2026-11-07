# A teleported session can come back to the host it left (issue #870)

## Context

A teleport copies an idle session to another host. The source keeps its transcript, and the import
refused any Claude session id the target already had (`teleport_exists`), so a session moved from A
to B could never move back to A. The teleport decision
([2026-11-06-teleport.md](2026-11-06-teleport.md)) says the import never replaces a local transcript.

## Decision

- **Fast-forward on return.** The import accepts a session this host already has when this host's
  copy is a byte prefix of the incoming transcript: the same session came back with more turns, and
  every turn here is in what arrives. It refuses (`teleport_exists`, as before) when:
  - the copy here has bytes the incoming one lacks: it diverged;
  - this host's managed session of it is not idle or ended: something here is working on it;
  - either file cannot be read.

  A refusal runs on the package still in the inbox, so it stays to try again.
- **This host's copy is set aside, never deleted.** After the claim, `<id>.jsonl` is renamed to
  `<id>.jsonl.replaced-<utc>` in its own folder (Claude Code reads only `*.jsonl`).
  - The prefix is checked again on the renamed file, since the copy may have grown since the checks.
  - Any failure from there (a copy that grew, a session that does not start) copies it back to
    `<id>.jsonl`, never over a file that appeared there meanwhile: then it stays set aside.
- **After the session starts:**
  - this host's old managed record of it is closed;
  - its `archived` flag is cleared. `session_meta` is per host and keyed by the Claude session id,
    and slice R2 archives the copy a session leaves from, so without this a returning session would
    stay hidden.

  Neither step undoes a session that started.
- **Slice R2 (the app):** after a confirmed `teleport.finish`, the source's copy is archived, as a
  hint that the session now lives elsewhere. It is best effort, within the clean-up the app already
  runs on the source, and it moves no file. R2 must not ship before R1.

## Discarded alternatives

- **The source archives its copy and moves its transcript aside after the move.**
  - It needs the source to answer after `finish`: a source that went offline keeps the id for good.
  - It moves files before anyone asks for the session back.
- **"Replace the copy on <host>" in the dialog.** It would overwrite turns that may exist only on
  this host, with a warning as the only guard. It may come later for a diverged copy, if that turns
  out to be common.

## Consequences

- A round trip relies on transcripts being append-only and packaged byte for byte (today secrets
  are only counted). If a resume ever rewrites a transcript, or a later slice redacts the package,
  the prefix check fails and the move is refused; nothing is lost. A redacting slice must compare
  against this host's copy as it would be packaged.
- A Claude Code process outside Flightdeck that still has the old file open writes to the
  set-aside file. Its turns are kept there, not in the session that came back.
- The real check is a manual A → B → A move (fd-qa's script, #14): tests never run the real Claude.
