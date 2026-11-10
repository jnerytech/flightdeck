# Phase 12 decisions: the interface (`linha-do-tempo-ui` and `agente-ui`) (phase 12)

What the spec left open for the screens, and where the implementation went further than the
daemon and protocol areas. Texts follow `docs/GLOSSARY.md`; every visible text comes from the
dictionary, in pt-BR and English.

## Timeline

- **Where:** a "Linha do tempo" button in the header of a managed session and of a terminal session
  opens a side sheet. It shows only when the host announces the new `checkpoints` feature, so an
  older daemon keeps its screens as they were. The history reader (a transcript with no live
  session) has no timeline: "Continuar" and the fork of a terminal session cover it.
- **A turn** is a `before` snapshot; its numbering on screen is the order the turns ran (1, 2, 3…),
  while the commands use the snapshot's `n`. `safety` snapshots are not turns.
- **Files per turn:** the protocol had no source for them. `snapshots.list` has only the trees, and
  `rewind.preview` compares a turn with the working tree *now*, which is cumulative. A new command,
  `snapshots.files {claudeSessionId, n}` (area `snapshots-arquivos`), gives the name-status and the
  lines between the turn's `before` and `after` trees, read with `git diff-tree` from objects only.
  The row says "Mudou arquivos" / "Sem mudança nos arquivos" from the two trees, which already come
  in the list, and loads the files only when the turn is opened. A turn with no `after` yet is "Em
  andamento" when it is the last one and "Sem registro do fim do turno" otherwise, and has no files.
- **Rewind:** preview, then a dialog with the files, what happens to each (goes back, is removed
  because it was created later, is restored), the lines, the way it goes back (SDK checkpoint or git
  snapshot) and the note that only the repository's files return. The confirming button is the
  confirmation (`confirm: true`); the preview is read-only. After it, the sheet offers "Desfazer
  volta" (`rewind.undo`) until it is used. It is disabled, with the reason, while the session is in a
  turn (starting, running or waiting for a permission). The dialog never opens a second request: the
  preview is loaded once, even though the parent renders again.
- **Fork:** "Bifurcar daqui" asks where to open (Flightdeck, or the terminal) and whether the files go
  back too (`rewindTurn`, with its own preview). A managed session opens as a new session in the app;
  for the terminal the dialog shows the command the daemon returns, and the terminal button of the
  new session.
- **Forking a terminal session** needs the uuid of the user's message, which the hooks do not send
  (area `bifurcar-terminal`). `snapshots.list` finds it on demand in the transcript the history index
  already reads: the prompt of the turn is matched with the user messages of the same text. Several
  turns with the same prompt match in the order they were said, but only when there are as many turns
  as messages; otherwise (more turns than messages, the other way round, a message not indexed yet)
  nothing is chosen. That differs from "the closest timestamp after the snapshot": the snapshot is
  taken in the background, after the message was written, so the time says little, and the order
  does not depend on it. With no match the fork is disabled on that turn, with the reason on screen,
  instead of forking the whole conversation.
- **Under happy-dom,** Esc in a dialog inside the sheet also reaches the sheet (in a browser Radix
  closes only the top layer), so the tests close the dialogs with their own button.

## Agent screen

- **Where:** Projetos → "Agente de {project}", a route of its own (`agent`) with the breadcrumb
  host › Projetos › project › Agente. The button shows only when the host announces `agentcfg`.
- **MCP tab:** the servers of the `.mcp.json`, of the user's `~/.claude.json` and of the user's
  config for this project, each with its origin and "Só leitura" on the user's. Only the `.mcp.json`
  ones can be edited or removed, and the on/off switch of the others is disabled. The `.mcp.json` is
  versioned, and the screen says so in the tab and in the form.
- **Secrets:** `env` and `headers` come masked (`••••••`) and are never shown. Editing a server that
  has them leaves "Salvar" disabled, with a notice, until each masked value is typed again; the
  daemon refuses the mask anyway.
- **Testar:** the first call has no `confirm` and returns the exact command and arguments (or the
  URL), which the confirmation dialog shows (an argument with a space is quoted); only the second
  call, with `confirm`, starts the server. Opening the list starts nothing (the test proves it with a
  server that writes a marker file when it starts).
- **Writes:** the form's "Salvar no .mcp.json" button, the removal dialog and the switch each send
  `confirm: true`. Nothing is written to `~/.claude` or `~/.claude.json`.
- **mcp-ao-vivo:** when a managed session is live in the project (status starting, running,
  awaiting_permission or idle, with a `cwd` equal to the project path or inside it; compared ignoring
  case and treating `\` as `/`), the MCP tab calls `mcp.status {sessionId}` on load and after each
  toggle, and shows a badge per server (connected, failed, needs login, connecting, disabled), the
  error on `failed`, and a line naming the session that answers. The switch passes `sessionId` in
  `mcp.toggle`, so it also reaches the live session. With no live session the tab behaves as before.
  The status comes from the SDK query (`mcpServerStatus`) or, in tests, from the FakeRuntime.
- **CLAUDE.md, Agentes and Skills:** the project's files are editable and the user's read-only. Saving
  sends the hash read when the file was opened; if the daemon refuses and the file's hash changed, the
  screen says so, keeps what was typed and offers "Recarregar". A new file is only written on its
  first save (`expectedHash: null`). Project files other than `CLAUDE.local.md` carry the "versioned"
  warning; `CLAUDE.local.md` says it usually stays out of git.
- **Frontmatter form:** `name`, `description`, and `tools` and `model` for an agent. Every other line of
  the frontmatter (other keys, quotes, lists, folded text) comes back as it was; a value over several
  lines is shown disabled, for the file itself. The form needs the name and the description, which the
  daemon requires too.

## Features announced by the host

`host.info` announces `checkpoints` (snapshots, rewind and fork wired) and `agentcfg` (MCP and agent
configuration wired), only when the daemon has them. The existing exact-list tests of the other
features did not change.

## Texts outside the JSX

The Phase 10 sweep only saw JSX text and attributes, so strings built in `.ts` files escaped it: the
palette's sections and actions, the messages of the store (shortcut, terminal, updates, budget
notification), the shortcut and host-probe errors, and the names of states and origins. A second
detector, `visibleTsLiterals`, finds values of `label`, `title`, `detail`, `body`, `error`,
`message`, `text`, `placeholder`, `description` and `shortcutProblem`, the text of `fail(…)` and any
string with a Portuguese accent, in `src/{lib,ui,hooks,components}`; thrown errors and comments are
left out. All of it now comes from the dictionary; label tables nothing read (`COLUMNS` labels,
`PR_LABELS`, `CHECK_LABELS`, `RUN_LABELS`, `STEP_LABELS`, `STATUS_LABELS`, `PERIOD_LABELS`) were
removed. The origin of a terminal session in the history list now reads "terminal" in both languages
(it said "externa").

## Demo, prints and e2e

- **Seed:** the project has an `.mcp.json`, a `CLAUDE.md`, an agent and a skill, and the temporary
  home has a user `CLAUDE.md`, an agent and a server in `~/.claude.json`. The session "Carrinho: soma
  do total" has two turns that change files. The snapshot before a turn is taken in the background,
  so a turn of the fake runtime that writes at once would be snapshotted already changed; instead each
  turn waits for a permission, the seed edits the files as the agent would, and approving ends it.
- **Prints:** the four tabs with a file of each open, the timeline, and its rewind and fork dialogs, in
  both themes and languages, with axe. `DEMO_SHOTS=<part of a name>` takes only the prints whose name
  has it, a failing preparation leaves a `*-FALHOU.png` of what the page showed, and page errors are
  logged. While building this, the "Precisa de você" print once found its Bash request missing, with
  an earlier version of the seed that ran file-writing turns in the shared repository. The app was
  instrumented to look for summaries arriving before the host was known: it adds a host to its state
  before it connects, the statuses and the summaries came in order, and the connection never
  dropped, even under eight CPU busy-loops. No race was found in the store; the final seed passed
  the prints three times in a row under that load, with no retry.
- **e2e:** a sixth journey, `voltar-arquivos`, rewinds the second turn and ends with "Desfazer volta",
  because the demo keeps its state from one language to the next. The Agente screen joins the layout
  check at 1280×800 and 800×600.

## Known limits

- The `Testar` of an MCP server is covered in the screen tests with a local stdio server; the e2e does
  not start one.
- The dialogs and the sheet of the vendored shadcn components have a close button with an English
  `sr-only` text ("Close"). The sheet and the dialogs of this phase have their own buttons, but the
  vendored text stays; changing it means changing the vendor files and their lock.
- Whether the SDK accepts the uuid Flightdeck gives the message in `rewindFiles` is still to be
  checked with the real Claude, as the daemon area already says.
