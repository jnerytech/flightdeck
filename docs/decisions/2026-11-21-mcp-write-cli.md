# The write side of a project's MCP servers from a shell, part 1 (issue #3616)

Slice 2 of the `mcp` noun, after [the read side](2026-11-21-mcp-cli.md): `mcp test --confirm`, `mcp remove` and
`mcp toggle`. `mcp save` is the third slice.

`test --confirm` starts the command a project's `.mcp.json` names and lists the tools and resources it offers;
`remove` deletes a server from that file; `toggle` turns a server on or off for the project's next sessions (and for a
live one, with `--session`). A server is a command the host runs, so the verbs that start one or let one run are the
app's decision and carry two guards.

- `--confirm` is required by `remove`, by `test` that starts the server (no flag keeps the preview of slice 1) and by
  `toggle --enable`. `toggle --disable` takes none: it only stops a server, so it grants nothing, and
  `--disable --confirm` is refused so the flag never reads as if it mattered. The daemon refuses all three without
  `confirm`; the CLI sends it, since the person's `--confirm` is the CLI's own confirmation.
- The direction of a toggle is `--enable` or `--disable`, not `--on`/`--off` or a bare word: both flags already exist
  for the terminal's settings, so `takeMcpFlags` moves them to `mcpEnabled` on `mcp` and the terminal's check does not
  read them. `--session` (the live session whose server list is refreshed) joined the commands that allow it, and
  `--confirm`, `--session`, `--enable` and `--disable` are each refused on the verbs they do not belong to.
- `--confirm` is only a flag the caller types, so it proves nothing against a session that runs the command from its
  own shell. The risk rules are the guard there (`mcp-risk.ts`): `mcp remove` is **high** always (the coordinator
  settled that, 2026-11-21); `mcp toggle` is high unless its only flag is `--disable` (`--json`, `--host` and
  `--config` do not count); `mcp test` is high with any flag but those three, and with any word the shell expands. The
  preview test, `list`, `status` and the bare stdio server stay ordinary. `mcp` joined the nouns whose verb a shell
  expansion may hide (`VERB_NOUNS`), so `fd mcp $A api files --confirm` is high too. `toggle --disable --session s1` is
  also high (a strict rule, the same as `watch`): a known false positive, cheap to ask about.
- Rules per noun now join in `noun-risk.ts`, one list that `risk.ts` reads. `risk.ts` sat at the 800-line limit of the
  source-size ratchet and each noun cost it an import and a spread. A structure-only commit moved the list; a new noun
  adds a file and a line to `noun-risk.ts`.
- A daemon that does not answer a `remove` or a `toggle` leaves its result unknown: exit `2`, and the message says to
  check with `mcp list` before trying again. A `test --confirm` is not one of those: it changes nothing on disk.
- The tool and resource names of `test --confirm` come from the server that was started, so they are untrusted text:
  they are printed through the same sanitising printer as the list.
- `remove` and `toggle` print what `list` prints for the servers left (`removed <name>` first for a removal), and
  `--json` prints `{ "servers": [...] }` as `list` does; `test --confirm --json` prints `{ "tools", "resources" }`.

Not in this slice, and gaps to report: nothing stops a token holder from `test --confirm`, `remove` or `toggle` over the
wire (the daemon takes them from any paired client, as the app does), and the proof of the person's approval of #3439
does not cover them. `args` and `url` are not masked by the daemon, so a secret in either shows in `list` and `test`.
