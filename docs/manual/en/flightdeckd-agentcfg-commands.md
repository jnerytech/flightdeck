# flightdeckd commands: agent setup files

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/flightdeckd-agentcfg-commands.md)

The verbs that read and write a project's `CLAUDE.md` files, agents and skills. They work as the other `flightdeckd` commands do: see
[what they all share](flightdeckd-commands.md#what-they-all-share).

## fd agentcfg

```sh
fd agentcfg list api --kind agent
fd agentcfg read api --kind agent --path .claude/agents/reviewer.md
fd agentcfg write api --kind agent --path .claude/agents/reviewer.md --file next.md --expected-hash <hash> --confirm
fd agentcfg write api --kind skill --path .claude/skills/lint/SKILL.md --file - --new --confirm < SKILL.md
```

The commands behind the Agent setup screen: a project's `CLAUDE.md` files, agents and skills. `--kind` is
`claudemd`, `agent` or `skill`. The project is its name or its id. Add `--host <name>` for a paired host and
`--json` for one value with stable keys.

- **`list`:** one file per line: its path, where it comes from (`project` or `user`), `editable` or
  `read-only`, its hash, and its name and description when it has them. A kind with no files says so, and
  `--json` prints `{"items": []}`.
- **`read --path <file>`:** the file's path, origin and access, then `hash: <hash>`, a blank line and the content.
  `--origin user` reads a file of your own `~/.claude` instead of the project's. With `--json` it prints the
  item and its `content`, exact. In the text the content has its control characters turned into spaces, so a
  file cannot move your terminal's cursor or retitle its window.
- **`write --path <file> --file <path> --expected-hash <hash> --confirm`:** replaces the file with the content of
  `--file` (`--file -` reads standard input). The hash is the one `read` printed: the write is refused with
  `agentcfg_changed` when the file changed since, so you never overwrite a change you have not seen. The CLI
  never reads the hash for you. To create a file that must not exist yet, pass `--new` instead of the hash;
  an existing file is then refused with `agentcfg_exists`. It prints the new hash; with `--json`, `kind`,
  `path` and `hash`. A write needs a near connection: an agent or a skill can declare hooks that run a command, and a
  `CLAUDE.md` steers every session of the project, so over a far connection (not this computer or Tailscale) the
  daemon refuses it with `transport_refused`. Reading answers anywhere.

The daemon keeps every rule: a path outside the project or outside the folders of that kind, a missing or
invalid frontmatter, and the read-only files of `~/.claude` are refused with its own words, and the CLI exits
`1`. A write that gets no answer exits `2` and says the file may or may not have changed: `read` it again
before you write again. Run from a session's own shell, `agentcfg write` is a high-risk command: every later
session of the project reads the file as its own instructions, and `--confirm` and the hash are only words
typed at a prompt. `list` and `read` stay ordinary.
