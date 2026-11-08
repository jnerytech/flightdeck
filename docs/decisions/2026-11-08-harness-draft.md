# A CLAUDE.md drafted by the host's model, held by the host, applied by its digest (issue #75)

## Context

#75 asks for a "generate with Claude" step: a draft of the harness that comes back as the same
reviewable preview. The S4 rules stand (docs/decisions/2026-11-07-harness-apply.md): apply never
takes content from the app, and a hook command never comes from a model. The design is on #75 (G1);
this record covers slice G1a, the daemon.

## Decision

- **What is drafted.** A `CLAUDE.md` only, and only for a project that has none (as S3 proposes new
  files). No hook, permission, MCP server or script comes from a model: a model writing allow or
  deny rules would be granting permissions.
- **What the model is told.** The detected stack, its commands (test, lint, format, build), and the
  project's top-level names, as a JSON array marked as data. A name is told only when it is plain
  (letters, digits and `. _ - @ +`, no space, at most 64), so a name is a word, not a sentence.
  That narrows what a project someone else controls can steer; the real control is the person
  reading the draft in the preview before the apply. Hidden
  names are left out, at most 60 are told, and any name the secret scanner flags is left out. Never a file's content, so the files cannot inject instructions and no `env` value goes out.
  The system prompt forbids inventing commands or paths, and writing hooks, permissions or scripts.
- **How it runs.** A one-shot `complete` on the host's runtime, in the assistant's scratch folder,
  with low effort and no thinking. The model is the careful host default. The call is refused
  while the plan's quota is used up (`assistant_quota_blocked`), as the assistant's calls are.
- **What comes back.** It must be Markdown that starts with a level-1 heading and is at most 32 KiB
  (else `harness_draft_failed`), and hold nothing the host's scanner flags, the vault's values
  included (else `harness_draft_secret`, and it is not kept).
- **Held, not sent back.** The host keeps the draft by its project and its sha256 (two projects may
  be drafted the same text), for CLAUDE.md only, for 30 minutes, at most 16 drafts. One draft runs
  per project at a time: a second ask waits for the first instead of spending again. `project.harness.draft` returns the content (for the preview) and
  the digest.
- **Applied by digest.** `project.harness.apply` takes no new field. When its digest for `CLAUDE.md`
  is a held draft's for the same project, that draft is the proposal written. Any other digest is
  the template's, or stale. A restart or an expired draft gives `harness_stale`. The text written is
  always the host's own.
- **Guards.** The feature `harnessDraft`, and a near connection only: the call spends the plan, and
  its text may be written.

## Alternatives discarded

- **A session in plan mode drafting the whole harness.** It runs with tools in the project and can
  read every file, so its output could carry a file's content or follow instructions planted in one.
  It is also costly.
- **The app drafts with its own assistant and sends the text.** That breaks "apply never takes
  content from the app".
- **Drafting hooks, permissions or skills too.** A model writing permissions grants them, and hook
  commands from a model are what #75 rules out. Skill and agent bodies may follow if wanted.

## Consequences

- G1b adds "Draft with Claude" to the set-up dialog. It shows the draft in place of the CLAUDE.md
  template, and its apply sends the draft's digest.
- An improved CLAUDE.md for a project that has one (which overwrites the person's text) stays out of
  scope.
