# Interface

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/interface.md)

## Design and navigation

The app follows a single design, in the style of Linear: bundled Inter (no network), a 13 px
base, layered surfaces, a single accent token and the session state as a glyph in a 12 px slot,
a shape as well as a colour: running is a blue ring that turns (still, with its top open, when
the system asks for reduced motion, and stopped while it is off screen), needs you an amber
question mark in a bubble, error a red alert circle, idle a small gray dot and ended a faded ring.
Hover one for its name.

- **Sidebar:** logo, navigation (Sessions, Needs you with its counter, Board, Workflows, Costs,
  History), the hosts, the pinned sessions and, at the bottom, search (`Ctrl K`), Settings and
  the theme. It collapses to a 56 px icon rail, by itself below 1024 px, and below 640 px it becomes a drawer.
  In a wide window the button folds it to the rail and back, and the app remembers the choice for
  the next time it opens wide.
- **Window size:** the window opens at 1200 x 800 and can shrink to 360 x 480, as narrow as a phone,
  to sit beside an editor. Narrow, the sidebar is a drawer and the tabs are one button.
- **Three columns** in Sessions, Needs you and History: the list on the left (adjustable,
  remembered width), the session, request or transcript on the right. Board, Costs, Settings and
  the host pages use the full width. The header shows the path (Sessions > session, History >
  host, Board > project > card).
- **Keyboard:** `J` and `K` move through the list, `Enter` opens, `Esc` closes the detail, `A`
  and `N` approve and deny, `Ctrl K` opens the palette, `Alt+←` and `Alt+→` go back and forward.
- **Density:** compact rows (32 px, the default) or comfortable (40 px), in Settings.
- **Prompt cache timer** (Settings, off by default): Claude Code keeps the start of a conversation
  cached for 5 minutes (1 hour with extended caching, **Cache lifetime** in Settings), and replying
  inside that window is cheaper. With the timer on, an idle session on the Sessions list (row and
  card) and in its status line under the message box shows a small clock with the time left as
  `m:ss`, in the warning colour for its last minute and as a clock alone once the cache is cold (the next message re-sends the whole context as
  uncached tokens). Screen readers hear "Prompt cache expires in 2 minutes 10 seconds". The session's tab carries the
  clock icon alone in its corner (the time is in its tooltip), so the tab gets no wider. The
  countdown does not run for sessions that are running or ended, one 1-second clock serves them
  all, and it stops while the window is hidden.
- **Theme:** Light, Dark and System (the default), in Settings, in the sidebar and in the
  palette. The choice is remembered.
- **Language:** the system's (`pt-BR` for any `pt-*`, `en` for the rest), switched in Settings or
  in the palette, without restarting. Dates and times are always shown in local time. The
  vocabulary is in [`docs/GLOSSARY.md`](../../GLOSSARY.md).
- **Permission modes** are shown with a name and a one-line explanation, never with the technical
  value; "Bypass permissions" warns in red and is offered only on a host that allows it.

## Demo mode, screenshots and end-to-end tests

```bash
bun run demo         # starts two fake hosts (fake runtime, seeded data) and the app's web entry,
                     # already paired, at http://localhost:1420
bun run demo:shots   # the screenshots, in 2 themes and 2 languages, in
                     # apps/desktop/screenshots/ (and axe-core, which fails serious and critical)
bun run e2e          # the five journeys in a real browser, in 2 languages, and the layout check
                     # at 1280x800 and 800x600 (runner: @playwright/test; E2E_ONLY=a,b picks
                     # journeys; -- --repeat-each 5 repeats them; report in playwright-report/)
```

Nothing leaves the machine and no real data is used. The scripts use the installed Chrome (or
Edge) through `playwright-core`; in CI, the `screenshots` job runs all three and publishes the
screenshots.

## Logs and diagnostics

If something breaks, send the log. The desktop app keeps its own log file in the system's app log
folder (on Windows `%LOCALAPPDATA%\dev.flightdeck.app\logs`, on Linux
`~/.local/share/dev.flightdeck.app/logs`, on macOS `~/Library/Logs/dev.flightdeck.app`), rotated at
5 MB across 5 files. It records what happens to hosts (connected, offline), what a host refused, the
result of update checks, and the webview's own errors and console warnings. **Settings >
Diagnostics** has **Open logs folder** and **Copy diagnostics**: the second copies the app's version
and system, each host's name, state, version and features (never an address or a token), and the
last 50 log lines, to paste in a message. Neither button exists in a browser.

When a host goes offline, the log says why, so a drop that repeats can be read (#939). The app writes one
line for each drop of a link that was online (a warning): the close code and reason, whether the host
or the app closed it, how long the link had been up, how long nothing had come from the host and how
long since its last heartbeat ping. The daemon writes one line for each connection that closes: the
name the client gave, the code and reason, whether the daemon (heartbeat timeout, wrong token, a
rotated token) or the client closed it, and the same clocks. Neither line holds a token, an address or
a message.

The daemon keeps its own log file too, `flightdeckd.log` in `~/.flightdeck/logs` (also rotated), and
`host.info` says where. On a host page, **Copy the host's last log lines** copies up to 100 of them.

Every line is redacted before it is written, by the same scanner that guards snippets and personas:
a token (GitHub, Slack, AWS, `sk-`, npm, GitLab, Stripe and Google keys, JWTs), an `Authorization`
or `Cookie` header, a name containing password, secret, token or key followed by `=` or `:` (also
inside JSON, as in `{"apiKey":"…"}` or `DB_PASSWORD=…`), `--password`/`--token` options, `curl -u`,
a whole private key block, a password or a token in a URL, a webhook URL, a signed link and a
pairing link's token become `[redacted]`. Besides the patterns, the host never writes its own
tokens (the protocol's, even after a rotation, and the hooks') or any value the vault holds at
that moment, and the app never writes a host's token or a vault value of 6 characters or more.
It is a pattern list, not a guarantee: a secret wrapped in base64, split over two log lines, or a
short vault value (under 6 characters) is not caught. Your home folder (`/home/<name>`,
`/Users/<name>`, `C:\Users\<name>`) is written as `~`. The log folder is private to you (0700, files
0600) and a link planted in it is never followed. A host gives its log (`logs.tail`) and its path only
to connections from loopback or Tailscale, like the vault, and never more than the last 256 KiB of
each file. Read the lines before you post them in public.

## Performance

What keeps the app and the daemon light, and the numbers you can read yourself.

- **Long lists.** The hub shows the first 200 sessions of a host; **Show N more** adds the rest.
  A host reconnecting, or another host's summary changing, does not redraw the screens that do
  not show it.
- **Live text.** The daemon groups the streamed words of a reply into one frame every 25 ms
  instead of one frame per word, so a phone over a slow link keeps up. The order and content are
  the same; a client that is behind is resynced, not left to fall further.
- **Terminal.** The daemon stops reading a terminal's output while the app is far behind (a
  `yes` or a `cat` of a big file), and resumes when the app catches up. A terminal whose app
  never catches up is resynced from its saved output. The keys you type stay responsive.
- **On demand.** The editor, the Markdown renderer and the age library load when you first open
  something that needs them, so the app starts faster. A daemon with nothing to do keeps no
  running timers for features that are off (automations, budgets, PR watch).
- **Debug measures.** To time the five most used actions (open a session, a board, a card; send;
  approve), run `localStorage.setItem("flightdeck.debug.measures", "1")` in the console of a
  debug build and reload. The entries `fd:open-session`, `fd:open-board`, `fd:open-card`,
  `fd:send` and `fd:approve` then show in the browser's Performance panel (or
  `performance.getEntriesByType("measure")`). Nothing is written to the log or the console, and
  with the flag off nothing is measured. `send` and `approve` end when the daemon has answered.
- **Numbers for developers.** `bun run perf:baseline` prints the baseline,
  `bun run bundle:budget` the size of each chunk (the build fails above the budget) and
  `bun run smoke:perf` runs the daemon against a flood of output.
