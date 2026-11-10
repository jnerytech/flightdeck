# History

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/history.md)

Each host's daemon indexes that host's Claude Code transcripts, including the sessions that were
born outside Flightdeck (terminal, VS Code, Desktop). Transcripts are only read: nothing is
edited, deleted or copied between hosts. The only write to `~/.claude` is the hooks', by explicit
command (see [Claude Code hooks](session-hub-and-claude-code-hooks.md#claude-code-hooks)).

## What is indexed

- Each `<id>.jsonl` file in `~/.claude/projects/<folder>/` is a session; the id is the
  `claudeSessionId`. The project folder comes from the lines' `cwd` field.
- The search covers the text of user and assistant messages, plus one `[tool Name]` line per tool
  call. Tool results are not included, and each message is cut at 8 KB.
- The format is internal to Claude Code. Unknown line types are stored raw and left out of the
  search; lines that are not JSON are counted as errors and skipped.
- Reading is incremental (only what was appended), by file watching and by a sweep every 10 s. A
  file that shrank is read again from scratch.
- The search uses SQLite's FTS5; without it, the daemon falls back to `LIKE` and logs the
  decision at boot.
- A session is marked **possibly in use** when its file changed in the last 2 minutes.

The roots live in `history.roots` in the config, defaulting to `["~/.claude/projects"]`:

```json
{
  "history": {
    "roots": ["~/.claude/projects"],
    "excludeCwds": ["~/clients/confidential", "C:/Users/me/private"]
  }
}
```

## Excluding folders

Sessions whose `cwd` is a folder in `history.excludeCwds`, or lies inside one, never enter the
index. The comparison uses the `cwd` recorded in the lines, never the directory name under
`~/.claude/projects`. On Windows and macOS it ignores case and the slash type. Changed the list?
[Rebuild the index](#rebuilding-the-index): sessions already indexed only leave, and files
already excluded only come back, after that.

## Rebuilding the index

```sh
flightdeckd history reindex [--config <file>]
```

Deletes the history index and reads every transcript again, printing how many sessions and
messages went in. Stop the daemon first: with another process on the same `dataDir`, the command
exits with code 3.

## In the app

- **Per-host history** (🕘 next to the host name): indexed sessions with title, folder, date of
  the last message, origin (`Flightdeck` or `terminal`) and the "possibly in use" badge; filters
  by folder, period (whole days, in UTC) and origin. The **List/Cards** buttons (the same choice as
  the Sessions screen) draw each session as a card with title, folder, host, date, origin, the
  "possibly in use" badge and, on hosts that report costs, the estimated cost.
- **Global search** (`Ctrl+K` inside the app, or "Search the history"): it is the last section of
  the [palette](daily-use.md#palette-ctrlk). Enter, with nothing selected, queries every online host in
  parallel and merges the hits by date, with host, folder and a highlighted snippet. A host that
  is offline, or does not answer within 5 s, shows as "no answer" without blocking the rest.
- **Reader:** read-only, with the chat's look, loading pages as you scroll. Coming from the
  search, it opens at the hit; otherwise it opens on the latest messages, and "Load earlier" brings
  the ones before without moving what you are reading. A tool row (Bash, Read, Grep...) opens with a
  click, Enter or Space to its whole input (the command, the file, the pattern) and its result, read
  from the transcript when you open it; an error is red, a result over 64 KB is cut and says so, and
  a call with no result yet says it is still running or was cut short.
- **Where a conversation opens:** a session (managed, terminal or from the history) opens on its
  latest message and stays at the end while images, code and panels settle. If you scroll up, it
  stays where you are and the **Jump to latest** button counts the new messages ("3 new"). When you
  come back to a tab, the conversation is where you left it.
- **Continue in Flightdeck** turns the transcript into a managed session with `resume`. If the
  session is possibly in use, the app asks for confirmation first, because two processes writing
  to the same conversation corrupt it. **Copy command** copies `claude --resume <id>` for use in
  the terminal.
- **Global shortcut:** see [Global shortcut](daily-use.md#global-shortcut).
