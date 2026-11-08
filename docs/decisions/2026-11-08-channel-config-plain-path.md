# The channel config goes to a plain path on Windows (issue #936)

A session started by Flightdeck on Windows warned `server:flightdeck · no MCP server configured
with that name`. The config the wrapper writes names `flightdeck` and is valid JSON, so the likely
cause is that claude never read the file: on Windows `claude` is often the npm `claude.cmd` shim,
`cmd.exe` re-parses its command line, and a path with `&`, `^`, `%` or an accent outside the
console's code page reaches claude changed. The person has not sent the data path or
`where claude`, so this ships defensively; it stays `--refs 936` until they confirm.

## Decision

- **The rule.** On Windows, when the channel config's path (`<dataDir>\channels\<launch>.json`)
  holds anything but ASCII letters, digits and `\ / : . _ -`, the config is written to a plain
  folder instead. A space is outside the set too. A `.cmd` shim needs no rule of its own: what
  cmd.exe changes is all outside that set, so the path test covers it. On Linux and macOS nothing
  changes; a plain data path on Windows is used as before.
- **Where.** `%ProgramData%\Flightdeck-<launch id>\`, else `%PUBLIC%\Flightdeck-<launch id>\`
  (each only if its own path is plain). A folder per launch, because a standard user can create
  folders in `ProgramData` but not files in a folder another user made. `GetShortPathName` was not
  used: it needs 8.3 names, which many volumes have off, and it would add a native call.
- **Private before the token is in it.** The folder is made empty and restricted with
  `icacls <folder> /inheritance:r /grant:r <DOMAIN\user>:(OI)(CI)F` (the same call the SSH key
  delivery uses), and only then is the config, which holds the channel token, written into it. If
  the folder cannot be made, `icacls` fails or cannot run, or there is no user name or plain base
  folder, nothing is written and claude opens with neither channel flag and one line saying so
  (the behaviour of #949), never with a token file others could read.
- **Gone after the launch.** The file and the folder are removed when claude exits, as the file in
  the data folder is. A background session (`--bg`) leaves them, as it leaves the file now.
- **Also.** The config file in the data folder is now created with mode 0600 (it was 0644; the
  token is in it).

## Not covered

- The persona and index files (`--append-system-prompt-file`, `--agents` files) are also passed by
  path from the data folder and would have the same problem behind a shim; they are not moved here.
- Cause 3 in the issue (a policy that hides servers from `--mcp-config`) is not something a path
  can fix. The person's data path and `where claude` still decide whether this was the cause.
