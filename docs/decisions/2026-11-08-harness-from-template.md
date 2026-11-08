# A setup can take its Markdown from a host template, vetted file by file (issue #75)

## Context

Slice T1a stores a project's Markdown harness as a host template
(`docs/decisions/2026-11-08-harness-templates.md`). T1b lets another project use it. The template's
text was written for one project. An agent's or a skill's front matter can name `hooks` or
`mcpServers`, set `permissionMode` or grant `allowed-tools`. Any of these runs commands or skips a
prompt in the project that takes it. A CLAUDE.md `@` import loads a file into every session.

## Decision

- **The source.**
  - `project.harness.preview` and `project.harness.apply` take an optional `template: <id>`.
  - With it, the Markdown parts (`claudeMd`, `agents`, `skills`) come from that template only. A part
    the template lacks proposes nothing: no fixed file and no held draft (G1) fills it.
  - Hooks and deny rules stay Flightdeck's fixed list (S3).
- **Read on each use.**
  - `HarnessTemplates.files(id)` reads the template through `readInside`, on every preview and every
    apply.
  - Apply makes its proposals again from what it reads, and the digests must match (S4). So a template
    changed between the two is `harness_stale`.
  - An id outside the template id rule refuses with `harness_template_id`; a missing template with
    `harness_template_missing`.
- **Paths.** `CLAUDE.md` → `CLAUDE.md`, `agents/<n>.md` → `.claude/agents/<n>.md`,
  `skills/<n>/SKILL.md` → `.claude/skills/<n>/SKILL.md`. Each is created only when missing, as before.
- **Withheld, never changed.** A file is not proposed, and the preview lists it in `withheld` with its
  reason, when:
  - it holds a secret (`secret`), since the vault may have grown since the export;
  - it runs a shell command as it loads: `!` then a backtick, or a fence of any length (three or
    more backticks or tildes) opened with `!`, wherever it starts (`command`);
  - it has an `@` import from the home folder, an absolute path, a drive, or a `..` segment (`import`);
  - for an agent or a skill, its front matter is not plain (`frontmatter`).
- **Plain front matter.** It is read two ways, so a parser that differs from Claude Code's cannot hide
  a key:
  - **Line by line.** The first line is exactly `---`, and the first `---` line after it closes the
    block. Every line between is blank, a `#` comment, indented with spaces, a `- ` item, or
    `<key>:` with a key from the allow-list. A `\r`, `U+0085`, `U+2028` or `U+2029` inside the
    block withholds the file too.
  - **As YAML.** The block parses (`Bun.YAML`) to a map whose keys are all in the allow-list.
  - **The allow-list.** `name`, `description`, `tools`, `disallowedTools`, `model`, `color`, `effort`,
    `maxTurns`, `argument-hint`, `disable-model-invocation`, `user-invocable`.
  - **What it catches.** A key Claude Code adds later is withheld until it is reviewed and added. A BOM,
    a leading blank line, `--- ` with a trailing space, a flow map, a quoted key, a `<<:` merge, a
    tab, `...` and a block that never closes all withhold the file.
- **Guards.**
  - Preview with a template is near-only, since it returns the template's text whole and T1a keeps
    that off far connections. A preview without a template stays open.
  - Apply stays near-only with `confirm`.
  - Both need the `harnessTemplates` feature when a template is named.
- **Names.** An agent or a skill name is plain characters, never hidden (`.`, `..`), never a Windows
  device (`CON`, `aux`, `NUL`, `COM1`), and never ending in a dot, which Windows drops.
- **Commit (C1).** It takes `.claude/agents/<n>.md` and `.claude/skills/<n>/SKILL.md` for a plain
  name. Each file must match its digest on disk and pass the scanner. An agent or skill already on
  disk may never have come through a setup, so commit vets it as a template's file is vetted
  (`unvetted`). A file that would be withheld is refused with `harness_commit_withheld`.
- **One name on both sides.** An agent's name is its file name without `.md`, on apply and commit
  alike, so `x..md` (the name `x.`) is refused by both. `list()` and `export` skip such names too;
  templates stored before this change list fewer files and are not migrated.
- **Protocol.**
  - The `digests` cap is 17: a template's 16 files and the settings.
  - `HarnessPreview.withheld` is optional, and present only with a template.

## Alternatives discarded

- **Strip the risky keys.** That writes YAML the person did not write and may not have seen.
- **Flag only, and let the person confirm.** A key in a long file is easy to miss in a confirm dialog.
- **A deny-list (`hooks`, `mcpServers`, ...).** A key Claude Code adds later would pass unseen.

## Consequences

- A template made from a project with richer agents (with `permissionMode`, say) gives fewer files
  elsewhere. The app (T2) shows each withheld file and why.
- The allow-list grows by review, as Claude Code's front matter grows.
- **Values are not vetted, only keys.** A `description` or a body is instructions to the model, and
  `maxTurns` or `effort` change behaviour and cost. That is what a template is for. T2's confirm view
  shows each file's full text, not just its path.
- **Limits.**
  - At most 16 files are read from a template. `export` never stores more, so only a folder edited by
    hand can have files left out, and nothing reports them.
  - An `@` import of a symbolic link inside the project that points outside is not detected. The
    apply writes files only, so such a link is one the person already has.
  - Apply creates the files in order, so a stale refusal on a later file leaves the earlier ones
    written (as in the 2026-11-07 apply decision). With up to 16 files this is more likely than with
    the 3 fixed ones. Each file is still created only where it was missing.
