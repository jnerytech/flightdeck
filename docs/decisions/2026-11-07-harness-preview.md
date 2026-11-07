# The harness preview sends additions, not a diff of settings.json (issue #75)

## Context

Slice S3 of #75 adds `project.harness.preview`. The approved design said that, for each file, the
daemon returns the current hash, the proposed content and a unified diff, with `settings.json`
merged additively.

That design has a problem. `.claude/settings.json` can hold `env` values. Its full proposed text, or
the context lines of a diff, would carry those values to the app. The harness checklist promises
never to show them (`ProjectLoad` sends `env` names only). Two more facts shape the decision:

- The daemon has no diff library. The desktop has `diff`.
- A parse, add and stringify of `settings.json` rewrites the person's whitespace and key layout.

## Decision

`project.harness.preview {path, parts}` returns two kinds of proposal. It writes nothing.

- **Settings** (`.claude/settings.json` only, never `settings.local.json`).
  - The proposal holds only the entries that would be added: hooks as `{event, matcher, command}`,
    and deny rules.
  - It also holds the file's sha256 (null when the file is absent), and `reformats`. `reformats` is
    true when writing the file back with its own indent would change bytes the person wrote.
  - It holds no other text from the file.
  - A malformed or non-object `settings.json` gets no proposal and is listed as unreadable.
- **New files** (`CLAUDE.md`, `.claude/agents/reviewer.md`, `.claude/skills/tdd/SKILL.md`).
  - These are created only when the file is missing. The "diff" is then the whole new file, with
    nothing of the person's in it.
  - Improving a file that already exists is later scope.

What the templates add:

- **hooks:** a formatter on `PostToolUse` (matcher `Edit|MultiEdit|Write`).
  - Its command is the detected stack's format command, which is a fixed form, never script text.
  - It is not proposed when the stack has no formatter, or when a hook of the same kind exists
    already.
- **permissions:** deny rules from a fixed list: `.env` files, key files,
  `~/.claude/.credentials.json`, and a wide `git add`.
  - Deny rules are Claude Code's own way to block a read or a command. They need no script, which
    matters because Windows is the first platform.
  - In S4 the checklist will also count these deny rules for the "secrets" and "git add" kinds.
- **claudeMd, agents, skills:** fixed English text, plus the stack's commands.
- **mcp:** no template. Which servers to use, and their network access, is the person's choice.

The hook kinds move from the app to `@flightdeck/protocol`, so that the checklist and the preview
recognise a hook the same way. A preview taken right after an apply proposes nothing.

The write is a pure merge of those additions, as fd-coordinator's acceptance requires.

- It appends to `hooks.<event>` and `permissions.deny`, and never changes or removes a key that is
  already there.
- A key in the way that holds something else is left as it is. For example, `permissions` might be
  a string, or `hooks.PostToolUse` might not be a list. The preview lists that key under
  `conflicts` and proposes nothing for it.

S4's `apply {path, parts, hashes, confirm}` regenerates the proposals on the daemon and checks each
file's hash.

- The hash must match the file as it was previewed. On a mismatch, apply refuses with a reason code
  and asks for a new preview.
- Apply never takes content from the client: the daemon writes only what its own templates
  produced.

Paths follow the S2b rule. Every read is a `realpath` inside the project and a plain file of a sane
size. A `.claude` that is a link leaving the project gets no proposal.

The command is gated by the feature `harnessPreview`, which is listed in `DAEMON_FEATURES` and named
in both languages.

For S4, from the review of #923:

- **Repeat the walk before writing.** Right before writing, apply walks the path again with no link
  allowed anywhere on it, then opens the file without following links and hashes it from that same
  handle. The preview's hash catches a change of content, not a link swapped in after the preview.
- **Say that the formatter runs the project's own script.** The proposed formatter hook runs
  `<runner> run format`, whose body comes from `package.json` and can change with a later pull. The
  confirm step shows the command and says this.
- **Call the deny rules best-effort.** They block Claude Code's `Read` tool and the named `git add`
  forms. They do not block a shell `cat .env`. The app never presents them as a guarantee.

## Alternatives discarded

- **A unified diff from the daemon, as designed.** It would ship `env` values in context lines, and
  it needs a diff library in the daemon.
- **The full proposed text, with the app computing the diff.** It sends the same values.
- **Hook scripts for `git add` and secret files.** They would add a script file per project, and a
  shell to run it on Windows. Deny rules do the same job natively.

## Consequences

- The app renders a settings proposal as a list of additions, not as a diff. A new file is shown
  whole.
- A person whose `settings.json` would be reformatted sees that before applying. S4 decides whether
  to refuse or warn.
- The approved protocol shape changes from `{projectId, parts}` and per-file diffs to `{path, parts}`
  (as `project.trust.inspect` takes) and these two kinds of proposal.
