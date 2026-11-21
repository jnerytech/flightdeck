# flightdeckd commands: the MCP servers of a project

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/flightdeckd-mcp-commands.md)

The verbs that read the MCP servers that apply to a project and the state each one reports in a live session. They
work as the other `flightdeckd` commands do: see [what they all share](flightdeckd-commands.md#what-they-all-share).
They change nothing and start nothing. Saving, removing and turning a server on or off stay in the app.

## fd mcp

```sh
fd mcp list api
fd mcp list api --json
fd mcp status 5b1c0e
fd mcp test api files
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

With `--json` the commands print one JSON value with `null` for a missing field. The daemon already masks the secrets
of a server there. The text and the JSON print the arguments of a command whole, so a secret belongs in a variable,
not in an argument. `--host <name>` reads a paired host.
