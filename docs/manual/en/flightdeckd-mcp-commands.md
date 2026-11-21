# flightdeckd commands: the MCP servers of a project

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/flightdeckd-mcp-commands.md)

The verbs that read the MCP servers that apply to a project and the state each one reports in a live session, and
those that test (start), remove or turn on or off a server. They work as the other `flightdeckd` commands do: see
[what they all share](flightdeckd-commands.md#what-they-all-share). Saving a server stays in the app.

## fd mcp

```sh
fd mcp list api
fd mcp list api --json
fd mcp status 5b1c0e
fd mcp test api files
fd mcp test api files --confirm
fd mcp remove api files --confirm
fd mcp toggle api files --disable
fd mcp toggle api files --enable --confirm --session 5b1c0e
```

`fd mcp` with no verb is not one of these: it starts the MCP server that Claude Code launches on this host, over
standard input and output, as it always did. A verb is the word right after `mcp`.

`list <project>` prints the servers of a project, named by its name or its id, one line each: the name, where it comes
from (`project` for the project's `.mcp.json`, `user` or `user-project` for your own file), the transport, `on` or
`off`, `editable` or `read-only`, the command or the link it runs, and the names of its secrets (never their values).
A name that two projects share is refused with their ids. A project with none prints `no MCP servers`.

`status <session>` prints the state each server reports in a live managed session, named by its id: `connected`,
`failed`, `needs-auth`, `pending` or `disabled`, and its error when it has one. A session the host does not know is
refused with exit `1`.

`test <project> <server>` prints the exact command (or link) that a test of the server would run, and starts nothing.
With `--confirm` it starts the server, as the app's Test button does, and prints the tools and the resources it offers
(`tools: a, b`, `resources: none`). Read the preview first: the server is a command from the project's `.mcp.json`.

`remove <project> <server> --confirm` deletes the server from that file and prints the servers that are left. It needs
`--confirm`.

`toggle <project> <server> --enable | --disable` turns a server on or off for the project's next sessions and prints
the servers. `--enable` lets the server run, so it needs `--confirm`; `--disable` only stops it and takes none (and
refuses `--confirm`). `--session <id>` also refreshes that live session. A server of your own user file (`read-only`)
is refused.

If the host does not answer a `remove` or a `toggle`, the result is unknown: the command exits `2` and says to run
`mcp list` before trying again. A session's own shell cannot use these as the person would: `--confirm` is only a
word the caller types, so the permission check treats `remove`, `test --confirm`, `toggle --enable` and anything that
is not a plain read as high risk and asks you.

With `--json` the commands print one JSON value with `null` for a missing field. The daemon already masks the secrets
of a server there. The text and the JSON print the arguments of a command and a link whole, so a secret belongs in a variable or a
header, not in an argument or in a link. The text lines separate their fields with two spaces and a name may hold some:
a script reads `--json`. `--host <name>` reads a paired host.
