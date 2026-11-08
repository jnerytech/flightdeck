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
  folders in `ProgramData`. `GetShortPathName` was not used: it needs 8.3 names, which many
  volumes have off, and it would add a native call. The base must be a local absolute path (no
  network share, no relative path, no `..`), and `icacls` is run from `%SystemRoot%\System32`, not
  looked up by name.
- **Private before the token is in it.** The folder is made new (one already there is not ours and
  is left alone) and restricted with `icacls <folder> /inheritance:r /grant:r
  <DOMAIN\user>:(OI)(CI)F` (the same call the SSH key delivery uses). Until that runs, the folder
  has the default ACL of its parent, so another user could put a file in it first: after `icacls`
  the folder must still be empty, and the config is created with `wx` (it fails if a file by that
  name exists), so a planted file or link never receives the token. If any step fails (folder
  exists, `icacls` fails or cannot run, the folder is not empty, no valid user name, no local
  base, the write fails), nothing is written, the folder is taken away if it is empty (one with
  something planted in it is left alone, never deleted recursively) and claude opens with neither
  channel flag and one line saying so (the behaviour of #949).
- **The account.** `USERDOMAIN\USERNAME` from the environment, refused if it holds anything
  `icacls` would read as more than one plain account (`* : / \ ; , = + ? " < > | [ ]`, control
  characters, only spaces). A SID from `whoami /user` would be stricter; it is left for the
  person's Windows check.
- **Gone after the launch.** The file is deleted and the (empty) folder removed when claude exits,
  as the file in the data folder is, and also when something fails between writing the config and
  starting claude. A background session (`--bg`) leaves them, as it leaves the file now. A hard
  kill of the wrapper leaves them too (ACL'd to the user).
- **Also.** The config file in the data folder is now created with mode 0600 (it was 0644; the
  token is in it).

## Not covered

- The persona and index files (`--append-system-prompt-file`, `--agents` files) are also passed by
  path from the data folder and would have the same problem behind a shim; they are not moved here.
- Cause 3 in the issue (a policy that hides servers from `--mcp-config`) is not something a path
  can fix. The person's data path and `where claude` still decide whether this was the cause.

## The other files claude is given by path

The same cmd.exe re-parse hits every file Flightdeck names on claude's command line, not only
`--mcp-config`: `--append-system-prompt-file` (the persona body and the library's index, one file)
and `--agents` in print mode (the subagents' JSON). They come out of the data folder's `personas`
folder, so a non-plain data path breaks them the same way. They now go through the same rule and
the same folder: one private folder per launch holds the channel config, the persona/index file and
the subagents file, made when the first of them is written, restricted once, and taken away with
them. They are created with `wx` there too. Where the plain folder cannot be had, these files stay
in the data folder as before (a persona or an index that claude cannot read is not worse than
before), while the channel stays off as above. A file is noted before it is written, so a
half-written one is taken away with the rest, and a file that cannot be taken away never fails the
launch. The interactive `--agents` is inline JSON, not a path, and is unchanged.
