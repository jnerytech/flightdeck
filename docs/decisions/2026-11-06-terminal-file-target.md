# A terminal's folder is a target of the Files viewer (issue #506)

## Context

The last slice of #506: a `path:line` clicked in the terminal (link detection from #546) opens in the Files viewer at that line. The viewer reads through review targets, and `Changes.resolve` knew only `session:<claudeSessionId>` and `card:<id>`. A plain terminal has neither.

## Decision

- A new target, `terminal:<terminalId>`. Its root is the folder the terminal was opened in, which `resolveAllowedCwd` checked against `allowedRoots` at open time, and never a folder the client names. `TerminalManager.cwdOf` answers `null` for an unknown terminal and for a daemon-internal one (opened in the daemon's own folder, outside the roots), so both are refused with `terminal_missing`. Reads keep every check of `file.read`: `located`, `refuseCredential` and `readRegularSized`.
- The host announces `file.terminal` when it has both the terminals and the review files.
- The app resolves the clicked path from the terminal's folder. A path inside that folder opens in the lazy `FileViewer`, in a panel under the terminal, with the new `line`/`col` props: the line is selected, highlighted and scrolled into view. A path outside it (`..`, another drive, an absolute path elsewhere), or a host without `file.terminal`, keeps #546's behavior: show it in its folder on a host of this computer, copy it on another one.

## Discarded alternatives

- **Only through the terminal's Claude session** (`launchId`, then the external session, then `session:<id>`). This needs no daemon change, but a click in a plain shell, where compiler and test output appear, would still only reveal or copy.
- **The git top level as the root.** It would reach files above the terminal's folder. A path relative to the folder would also need a second base on the app's side. The folder itself is the narrower root, and it works outside a repository.

## Consequences

- `changes.get` takes a `terminal:` target too. In a folder that is not a repository it fails the way git does. The Files viewer the terminal opens does not ask for changes.
- The shell's later `cd` does not move the root: a path printed after a `cd` resolves from the folder the terminal was opened in, and falls back to show or copy when it lands outside.
