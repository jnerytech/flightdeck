# flightdeckd claude and the channel

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/flightdeckd-claude-and-the-channel.md)

## How it works

```sh
fd [claude arguments]
# the long form, the same: flightdeckd claude [claude arguments]
```

`fd` (the short name of `flightdeckd claude`) opens the real `claude` in the same terminal, with
the same arguments and the same exit code, and adds the Flightdeck channel. The channel is an
MCP server (`flightdeckd channel`) that lets the app send messages to that session as if you
had typed them.

- **The `fd` command:** `flightdeckd setup` puts a small launcher called `fd` in
  `~/.flightdeck/bin`, next to `flightdeckd` (`fd.cmd` on Windows). A subcommand after `fd` is that
  `flightdeckd` subcommand (`fd host`, `fd sessions`); anything else goes to `claude`. A prompt
  that starts with a subcommand word, such as `update` or `doctor`, goes to `claude` as
  `fd claude update the readme`. `fd --version` and `fd --help` answer for Flightdeck.
- **A file called `fd` that is not ours:** setup never replaces it. It says so and leaves
  `flightdeckd claude` as the way in. When another `fd` is earlier on the PATH, setup names it and
  prints the line that puts `~/.flightdeck/bin` first.
- **Arguments:** the wrapper adds `--mcp-config` (a temporary file) and
  `--dangerously-load-development-channels server:flightdeck`, and sets `FLIGHTDECK_LAUNCH_ID`.
  The project's `.mcp.json` is not touched.
- **Config:** since all the arguments belong to `claude`, the daemon config comes from
  `FLIGHTDECK_CONFIG`, or from the default path.
- **No `claude` on the PATH** (nor in `claude.executablePath`): it warns and exits.
- **No daemon:** it warns and opens `claude` anyway, without the channel.
- **With `-p` or `--print`:** it opens plain `claude`, with no channel and no warning. Print mode
  ignores the development channel.
- **Research preview:** the channel is a preview feature of Claude Code. Each launch shows a
  development-channel warning, which has to be accepted.
- **Known warning:** at launch, Claude Code shows
  `server:flightdeck · no MCP server configured with that name`, even though the channel works.
  The warning is evaluated before the `--mcp-config` servers and can be ignored.

| | plain `claude` | `flightdeckd claude` |
| --- | --- | --- |
| shows in the list, with live state | yes (with hooks) | yes (with hooks) |
| approve and deny from the app | yes | yes |
| live transcript | yes | yes |
| send a message from the app | no | yes ("controllable" badge) |

## Why the VS Code extension is left out

The Claude Code extension for VS Code and the Claude Desktop app run `claude` in SDK mode, which
ignores the development channel. In the proof of concept, the channel came up as an MCP server
inside the extension, but no message ever arrived. VS Code's integrated terminal is an ordinary
terminal: there, `flightdeckd claude` works.
