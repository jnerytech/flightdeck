# The write side of a project's MCP servers from a shell, part 2: save (issue #3616)

Slice 3 of the `mcp` noun, after [test, remove and toggle](2026-11-21-mcp-write-cli.md): `mcp save <project> <file> --confirm`.

`mcp.save` takes a server of seven fields (`name`, `type`, `command`, `args`, `env`, `url`, `headers`). Two designs were
weighed.

- **One flag per field** (`--type`, `--command`, `--arg` many times, `--env K=V`, `--url`, `--header K=V`). It reads well
  but puts every `env` and `header` value on the command line, where the shell history and the process list keep it, and
  `--url` is already the `hook` command's flag. A server with a token in a header is the common case.
- **A JSON file, or standard input** (`mcp save <project> <file|->`), as `agentcfg write --file` does and `snippet parse`
  takes its file. A secret never touches the command line, the verb needs no new flag, and the file is the shape the
  protocol already has (`McpServerInput`). **Chosen.** The cost is a file to write first; `fd mcp list --json` does not
  print one to edit, since it masks the secrets, and the manual says so.

The text is checked against the protocol's schema, strictly (`domain/mcp-input.ts`): a misspelled key is refused, since
the daemon would drop it and save a server with no `command`. A problem names the field and what is wrong with it,
never a value (an `env` value may be a secret and the message ends on a terminal); a file that cannot be read, that is
no JSON or that is not one object exits `1` before the daemon hears of it. The daemon still refuses a value that shows
as the mask, so a copied `list` cannot write the mask over a secret. A server with neither a `command` nor a `url` is
refused too: the schema leaves both optional for the app, but a saved one runs nothing. The file is read before a daemon
is asked, so a refused file is exit `1` even with no daemon, and `-` holds no connection open while it is typed. An
unknown key is named in the refusal (`unknown field: cmd`): the name is what a person needs to fix a typo, and a value
is never printed.

- `--confirm` is required (the daemon refuses a save without it, and the CLI sends it, as for `remove`). `--enable`,
  `--disable` and `--session` are refused on it; the file is a word, not a flag, so `save api -` and `save api f.json`
  need no change to the flags' table.
- `mcp save` is **high** always in the shell rules (`mcp-risk.ts`): it writes a command the project's sessions run.
- A daemon that does not answer leaves the result unknown: exit `2`, and the message says to check with `mcp list`.
- It prints `saved <name>` and the servers the project has, as `remove` prints, and `--json` prints
  `{ "servers": [...] }` with the secrets masked by the daemon.

Not in this slice, and gaps to report: a session can still write the file's content with its own tools and then run
the high-risk command, which the permission check asks the person about; nothing stops a token holder from `mcp.save`
over the wire, as for the other writes.
