# A project's Markdown harness is shared as a host template; settings never are (issue #75)

## Context

#75 asks to "export a project's harness as a template, to reuse in other projects", plus host-level
templates. The design is on #75 (T1, T2); this record covers slice T1a, the daemon's export and its
listing.

## Decision

- **Where templates live.** On the host, in `<dataDir>/harness-templates/<id>/`, as the task
  templates live in `<dataDir>/templates`. Any project on the host can use them, and nothing goes
  into a repository the person did not choose.
- **What a template holds.** Markdown only: `CLAUDE.md`, `agents/<name>.md` and
  `skills/<name>/SKILL.md`, copied from the project's `CLAUDE.md`, `.claude/agents/*.md` and
  `.claude/skills/<name>/SKILL.md`. Next to them is a `template.json` with the id and the title.
- **What it never holds.** The project's settings. `settings.json` can hold `env` values, and its
  hooks run commands; copying them into another project would run one project's commands in
  another. The hooks and deny rules a setup adds stay Flightdeck's fixed list (S3).
- **How it is read.**
  - Each file goes through `readInside`: no link anywhere on the way, one name, at most 32 KiB.
  - Each folder walked (`.claude/agents`, `.claude/skills`) must be a real folder with no link.
  - Only plain names (letters, digits and `. _ - @ +`) are taken, and at most 16 files.
  - A file that fails any of these is skipped.
- **Secrets.** The host's scanner, with the vault's values, checks every file before anything is
  written. A finding refuses with `harness_template_secret`, naming the file and never the value,
  and nothing is stored.
- **All or nothing.**
  - The template's folder is made without `recursive`, so an id already there refuses with
    `harness_template_taken`.
  - Each file is created with `createInside`.
  - A failure removes the folder.
  - An id must be lower case letters, digits and dashes, up to 40 (`harness_template_id`).
  - A project with nothing to share refuses with `harness_template_empty`.
- **The listing.** `harness.templates.list` gives each template's id, title, file names and size,
  never content.
- **The title** is scanned too, since every client can list it. A broken `template.json` costs its
  template's title (the id stands in), never the whole list.
- **Frontmatter, for T1b.** An agent's or a skill's front matter can name `hooks` or `mcpServers`,
  which run commands. T1a only stores the text. Using a template in another project (T1b) must
  strip or flag those keys, or show them before the apply.
- **Guards.** The feature `harnessTemplates`. Export only over a near connection: it reads a
  project's instructions into a store every project on the host can use.

## Alternatives discarded

- **A template in a repository (`.flightdeck/harness-template/`).** Using it from another project
  reads one project's files from another: a cross-project path to guard.
- **Templates kept in the app and sent on use.** That breaks "apply never takes content from the
  app".
- **Including settings, hooks or MCP servers.** That is a permission decision copied between
  projects.

## Consequences

- T1b lets `project.harness.preview` and `apply` take a template as the source of the new-file
  parts, still created only when missing and bound by digest.
- T2 (the app) adds "Share as template" on the project's Claude Code setup card, a template picker in
  the set-up dialog, and the list with delete in Settings.
