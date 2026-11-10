# Fixes after the real Windows test of v0.31.0 (issue #1711, moved from DECISIONS.md)

- **Interactive `claude` takes `--agents` as inline JSON.** A file path is only read with `--print`, so
  the wrapper (`flightdeckd claude`, the one place that builds the flag) passes the persona subagents
  inline when interactive and keeps the file in print mode. A Windows command line holds about 32 K
  characters and quoting grows the JSON, so past `INLINE_AGENTS_MAX` (20 000 characters; the built-in
  pack alone is about 13 K) the agents are dropped and the wrapper says so on stderr: the session
  opens without subagents rather than not at all.
- **A Windows `.cmd` or `.bat` shim gets no `--agents`.** The npm install of claude is a `claude.cmd`
  that forwards `%*`, so cmd.exe re-parses the line and mangles a JSON argument (escaping `( ) & | < >
  ^ % !` as `\u00XX` was not enough: the quotes themselves break). The wrapper (`isWindowsShim`)
  opens such a claude without subagents and says why on stderr; a native `claude.exe` (the default
  install) has no cmd.exe in between and gets the JSON. A proper `.cmd` escaping (cross-spawn's
  algorithm) can bring subagents back to the shim later. The decision is the pure
  `interactiveAgents(json, claude, platform)`, tested without spawning anything.
- **The test timeout is 15 s on Windows, 5 s elsewhere.** The Windows runners of CI are slow enough that
  tests passing in about 1 s on Linux hit bun's 5 s default (an 8.3 path, plugins, a file picker).
  `bun run test` (`scripts/run-tests.ts`) passes it as `--timeout` (`scripts/test/timeout.ts`): a
  `setDefaultTimeout` in the preload only reached the first file. A file that sets its own keeps it.
  It guards hangs, it is not a budget.
- **Closing a terminal tab detaches by default.** The close-tab dialog already offered Detach (the
  process keeps running on the host; reattach from the host's terminal list or the session's
  "Claude aqui" terminal) and End process. The dialog now opens with Detach focused (Radix focused
  Cancel), so a quick Enter never ends the session. A detached terminal with nobody attached is still
  ended by the host's idle timeout (120 minutes by default).
- **AskUserQuestion and ExitPlanMode have their own approval cards.** The card shows each question
  with its header, options (radio for one choice, checkboxes for several) and an "Other" text, and
  answers by allowing the tool with `updatedInput = {...input, answers}` (question text to the chosen
  labels, joined by ", " for several, or the Other text), the Agent SDK contract. Managed sessions
  pass it through `canUseTool`; terminal sessions through the PermissionRequest hook's
  `updatedInput`, so both can answer in the app. ExitPlanMode's `plan` renders as markdown with
  "Approve plan" and "Keep planning". No tool input renders as `[object Object]`: objects inside
  lists are JSON.
