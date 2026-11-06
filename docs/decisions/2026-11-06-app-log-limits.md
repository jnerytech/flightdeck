# The app's log stays bounded in a storm, and a log inside a log does not loop (issue #259)

## Context

The app's log (#255) wrote one IPC call per line, with no limit. A render loop that calls
`console.error` on every frame would send thousands of calls a second to the shell and fill the
5 × 5 MB files in minutes, pushing out the lines that explain the problem. The console override
forwarded to the log with no guard, so a sink or a secret scanner that logs while a line is being
logged would recurse. "Copy diagnostics" (#591) reads this log, so it has to stay useful in a storm.

## Decision

- **A rate per source, before a line is kept.** Each source (`console`, `window`, `host`,
  `refusal`, ...) has a token bucket: a burst of 50 lines, refilled at 10 a second from the
  injected clock. The check runs before the 200-line memory ring and before the sink, so a noisy
  source pushes neither the others' lines out of memory nor the files' history. Dropped lines are
  counted. Before that source's next accepted line, one
  `WARN app-log <n> lines of <source> dropped by the rate limit` line goes out; it is not
  rate-limited itself.
- **Batching by coalescing, not by a timer.** At most one write is in flight. Lines that arrive
  meanwhile wait in a queue and go as one `write(lines)` call when it settles, whether it resolved
  or failed. The first line of an error reaches the disk at once. A timed flush would lose the last
  lines before a crash or a window close, and those are the lines a diagnosis needs. The queue
  holds at most 500 lines. Past that, lines are counted, and one
  `WARN app-log <n> lines dropped: the log file could not keep up` line opens the next batch.
  `AppLog.flush()` waits for the queue; "Copy diagnostics" calls it before reading the tail.
- **Re-entrancy.** `AppLog.log` sets a synchronous flag while it runs. A log made inside it (by the
  sink, the scanner's values, or a console call either of them makes) is dropped, not queued. The
  flag is cleared in `finally`, so a line that arrives later, asynchronously, is never dropped.
  `installGlobalLog` installs once per console: a second install does nothing, so a call is never
  forwarded twice.
- **The shell takes a batch, capped.** `append_log(lines: Vec<String>)` refuses a call of more than
  1000 lines whole: the list crosses the webview boundary. Tauri has already built the list when
  the cap is checked, so the cap bounds the disk work and the time under the lock, not the call's
  memory. One `LOG_LOCK` covers the batch, and the rotation check runs per line. When rotation keeps failing, the live file now grows to twice the
  configured limit (it was a fixed 10 MB whatever the limit), so a test can reach the refusal.
- **A rotation that keeps failing drops no history.** Rotation used to delete the oldest file
  first and then shift. When the last rename failed (a viewer holding the live file on Windows),
  each retry deleted one more file, and a batch retries on every line. Now only the files below
  the first free slot move, and the oldest is dropped only when no slot is free. A failed rename
  leaves `.1` free, so a retry drops nothing.
- **No link at open time.** On Unix the live file opens with `O_NOFOLLOW` (`libc`, already in the
  tree through Tauri, now a direct dependency for Unix). That closes the gap between the `lstat`
  check and the open. Windows has no such flag. There the existing check is what refuses a link,
  and creating one needs a privilege.

## Discarded alternatives

- **A flush timer (every 250 ms):** fewer calls, but it loses the last lines and makes "Copy
  diagnostics" read a stale tail.
- **A rate limit only, one call per line:** simplest, but a burst under the limit is still one IPC
  call per line.
- **One global budget:** simpler, but one source in a storm would starve the host and refusal
  lines.

## Consequences

- Left for later, from the reviews:
  - Each line still does a `metadata` call and an `open` under the lock, which a storm on Windows
    with an antivirus may feel.
  - The file could be swapped for a FIFO between the look and the open. The folder is owner-only,
    and this predates #259.
  - The source name in a summary line is not scanned. Every source is a literal in the code.
- A real storm is summarized, not kept in full; the count says how much was dropped.
- The sink's contract is now `write(lines: string[])`. The webview and the shell ship together, so
  there is no compatibility window.
- The Rust tests now cover:
  - a batch in order;
  - a batch rotating between its lines;
  - the batch cap;
  - the refusal past twice the limit when rotation fails;
  - no history lost when the last rename of a rotation keeps failing;
  - the raw open refusing a link;
  - on Windows, rotation while a reader holds the live file (runs only in the scheduled Windows run).
