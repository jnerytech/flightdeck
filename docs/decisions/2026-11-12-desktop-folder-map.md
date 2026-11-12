# Desktop folder map (issue #1597)

The target of every top-level entry of `apps/desktop/src/components`, `lib` and `ui`, so the
remaining moves of #1597 follow one table instead of a choice per PR. Rules come from
`docs/decisions/2026-11-09-domain-modules.md` and CLAUDE.md "Structure": folders by domain
(`features/<domain>/`, names from `docs/GLOSSARY.md`), one public `index.ts` per domain, shared
primitives in `shared/`, no import cycles, one structural move per PR with behavior unchanged.

## Who moves what

- **fd-frontend** owns the sessions and board area. Rows marked **theirs** below are listed so
  the map is complete, but this session (fd-ux-designer) does not move them.
- **fd-ux-designer** moves every other row, one PR each, in the order of the last column.
- A row marked **stay** has no move planned.

## Target layout

- `features/<domain>/` holds the domain's components, store slice, pure rules and hooks. A
  `lib/<name>.ts` that only one domain uses moves into that domain; a `lib` file that two or
  more domains use goes to `shared/` (no domain imports another domain's deep file).
- `app/` is new: the root component, the lazy screen table, the router, the store and the log. It
  is the only place that may import every domain; no domain imports it.
- `shared/` is new. It holds our own primitives with no domain knowledge, in four folders:
  `shared/layout/` (the page, panel, stack, list and table primitives), `shared/feedback/`
  (dialogs, notices, busy and action buttons), `shared/status/` (dots, meters, progress),
  `shared/lib/` (formatting, keys, paths, width and draft helpers). Moving `components/layout`,
  `feedback`, `status` and `markdown` there is one PR per folder (the first PR of each folder
  adds the `GLOSSARY.md` row and the `index.ts`).
- `components/ui/` **stays**: it is the vendored shadcn folder (`components.json` alias,
  Biome override, knip and coverage exclusions all name it), and the shadcn CLI writes there.
- `hooks/` is outside the three folders this map covers; a hook follows its domain the same way
  (`use-project-cards.ts`, `use-project-labels.ts` to `projects`, and so on) in a later PR.

## `components/`

| Entry | Target | Note |
|---|---|---|
| `approval/` | `features/permissions/` | the approval card, hold button and question form belong to the permission flow; `approval-lines.ts` and `gate-text.tsx` go with it. **theirs** if fd-frontend needs the card for the session view: ask before moving |
| `assistant/` | `features/assistant/` (new domain, GLOSSARY row) | the wand, model picker and keys; `refusal-text.ts` goes with it |
| `feedback/` | `shared/feedback/` | `action-button`, `busy`, `dialog-content`, `icon-action-button`, `icon-tip`, `inline-notice`, `notices`, and `confirm-dialog.tsx` (#2101 moves it from `ui/` to `components/feedback/`) |
| `layout/` | `shared/layout/` | primitives with no domain; `app-shell.tsx` and `breadcrumb.tsx` move to `features/shell/` (below) |
| `markdown/` | `shared/markdown/` | `markdown.tsx` and the lazy `markdown-body.tsx` (the lazy chunk must stay lazy: keep `bundle-reach` green) |
| `notifications/` | `features/notifications/` (new domain, GLOSSARY row) | center and preferences |
| `session/` | **theirs** (`features/sessions/`) | activity line, message actions, parts, tool rows, finish dialogs |
| `settings/` | `features/settings/` | `diagnostics-panel.tsx` only |
| `shell/` | `features/shell/` (new domain, GLOSSARY row) | account footer, quota bars, scope menu, status bar, top bar; with `app-shell.tsx` and `breadcrumb.tsx` from `layout/` |
| `shortcuts/` | `features/shortcuts/` | `keycap.tsx` only (the sheet already lives there) |
| `simple/` | `features/home/` (simple mode) | home, question and task views, settings view; `ui/simple/SimpleApp.tsx` goes with it |
| `status/` | `shared/status/` | meter, progress ring, status dot and text |
| `tabs/` | `features/tabs/` | overflow and switcher (the tab bar already lives there); **theirs** if the session view needs the file, ask first |
| `ui/` | **stay** | vendored shadcn |
| `whatsnew/` | `features/appupdate/` | the "what's new" dialog is part of the update story |
| `nav-icons.ts` | `features/shell/` | the sidebar and rail icons |

## `ui/`

| Entry | Target | Note |
|---|---|---|
| `App.tsx` | `app/` (new, with `main.tsx` wiring) | the root; moves last |
| `Areas.tsx` | `app/` | imports `Screen` from `Screens.tsx`: move it with or after `Screens.tsx` to avoid a cycle |
| `BoardView.tsx` | **theirs** (`features/board/`) | |
| `ConfirmDialog.tsx` | `components/feedback/`, then `shared/feedback/` | #2101 (in flight) does the first step; the second goes with the `feedback/` folder |
| `ExternalView.tsx` | **theirs** (`features/sessions/`) | |
| `FirstRun.tsx` | `features/hosts/` | **moved** (#2093) |
| `FolderPicker.tsx` | `features/hosts/` | **moved** (it browses a host's folders and already used `AllowedFolders`; `hosts` is the lower domain, so plugins, projects, teleport, the new-session form and the screens import it from the `hosts` index without a file-level cycle; `hosts` and `projects` import each other's index, the one pair to watch) |
| `Markdown.tsx` | `components/markdown/`, then `shared/markdown/` | the first step is **done** (#2099); the second goes with the `markdown/` folder |
| `NewSessionForm.tsx` | **theirs** (`features/sessions/`) | |
| `Screens.tsx` | `app/` | the lazy screen table; moves with `App.tsx`, after the features it loads are in place |
| `SessionTabs.tsx` | **theirs** (`features/tabs/`) | |
| `SessionView.tsx` | **theirs** (`features/sessions/`) | |
| `SessionsHub.tsx` | **theirs** (`features/sessions/`) | |
| `SetupPage.tsx` | `features/setup/` | **moved** (#2091) |
| `Sidebar.tsx` | `features/shell/` | 965 lines: split by reason to change (nav list, project tree, footer) in a later PR, not in the move |
| `StartScreen.tsx` | **theirs** (`features/sessions/`) | |
| `ToolCall.tsx` | **theirs** (`features/sessions/`) | |
| `lazy-screen.ts` | `app/` | goes with `Screens.tsx` |
| `simple/SimpleApp.tsx` | `features/home/` | with `components/simple/` |

## `lib/`

A file moves to the domain named in the row; `*` stands for the files that start with that
prefix. Tests move with their file in the same PR.

| Entries | Target |
|---|---|
| `app-store.ts`, `app-state.ts`, `use-store.ts`, `unique-keys.ts` | `app/` (the store is one slice per domain; slices already live in `features/*/store.ts` or `*-store.ts`, and each move shrinks this file) |
| `board*.ts`, `card-*.ts`, `conflict-radar.ts`, `file-changes.ts`, `review.ts`, `second-opinion.ts`, `word-diff.ts`, `diff.ts`, `pull-requests.ts`, `runs.ts` | **theirs** (`features/board/`) and `features/review/` for `file-changes`, `review`, `word-diff`, `diff`, `second-opinion` |
| `session-*.ts`, `hub*.ts`, `live-elsewhere.ts`, `start-elsewhere.ts`, `new-session-*.ts`, `turns.ts`, `tool-*.ts`, `history-tool.ts`, `activity.ts`, `finished.ts`, `hold.ts`, `awaiting-approval.ts`, `pending-text.ts`, `cache-timer.ts`, `tiles.ts`, `timing.ts`, `use-session-cost.ts`, `use-follow.ts`, `use-draft.ts`, `mode-menu.ts`, `model-menu.ts`, `prompt-menu.ts` | **theirs** (`features/sessions/`) |
| `approval.ts`, `ask-question.ts`, `vault-approval.ts` | `features/permissions/` |
| `assistant.ts`, `assistant-prefs.ts` | `features/assistant/` |
| `automations.ts`, `check-loop.ts` | `features/automations/` |
| `backup-*.ts`, `drive-target.ts`, `google-config.ts`, `google-oauth.ts` | `features/backup/` |
| `badge-icon.ts`, `notify*.ts`, `notice-*.ts`, `incident-text.ts`, `quiet*.ts` | `features/notifications/` |
| `away.ts` | `features/needs-you/` |
| `keep-awake.ts` | `features/hosts/` |
| `breadcrumb.ts`, `nav-active.ts`, `nav-badges.ts`, `sidebar-*.ts`, `tree-fold.ts`, `shell-prefs.ts`, `status-bar.ts`, `foot-account.ts`, `list-width.ts`, `use-width.ts`, `router.ts`, `workspace.ts`, `density.ts`, `theme.ts`, `scroll-edge.ts`, `whats-new.ts` | `features/shell/` (`whats-new.ts` to `features/appupdate/`; `router.ts` to `app/`; `list-width.ts` and `use-width.ts` to `shared/lib/` if two domains use them) |
| `client*.ts`, `costs*.ts`, `data-scope.ts`, `usage-rows.ts`, `measures.ts` | `features/clients/` for `client*.ts`; `features/costs/` for the rest |
| `deps*.ts` | `features/deps/` |
| `harness.ts` | `features/harness/` |
| `home-*.ts`, `simple-*.ts` | `features/home/` |
| `host-*.ts`, `hosts.ts`, `probe-host.ts`, `pairing-*.ts`, `request-link.ts`, `relay.ts`, `version.ts`, `setup-steps.ts` | `features/hosts/` (`setup-steps.ts` to `features/setup/`) |
| `inbox.ts` | `features/inbox/` |
| `issues.ts` | `features/issues/` |
| `frontmatter.ts`, `mcp-form.ts` | `features/agentcfg/` |
| `github-session.ts` | `features/hosts/` (the GitHub panel) |
| `grid-keys.ts`, `keys.ts`, `shortcut.ts`, `shortcuts.ts` | `features/shortcuts/` (`board-shortcut.ts` stays with the board) |
| `palette.ts` | `features/palette/` |
| `project-*.ts` | `features/projects/` |
| `quota*.ts` | `features/quota/` |
| `recap-preview.ts`, `summary*.ts` | `features/summary/` |
| `roi*.ts` | `features/roi/` |
| `snippets.ts` | `features/snippets/` |
| `tab-*.ts`, `tabs.ts`, `reveal-tab.ts` | `features/tabs/` |
| `teleport.ts` | `features/teleport/` |
| `terminal*.ts`, `xterm-*.ts`, `use-launch-terminal.ts` | `features/terminal/` |
| `trace.ts` | `features/trace/` |
| `tray.ts` | `features/tray/` |
| `vault*.ts` | `features/vault/` (`vault-approval.ts` goes to `features/permissions/`, listed above) |
| `watch-*.ts` | `features/watch/` |
| `webhook*.ts` | `features/webhook/` |
| `app-log.ts`, `kernel.ts` | `app/` |
| `backoff.ts`, `format-bytes.ts`, `paths.ts`, `utils.ts`, `file-language.ts`, `contrast.ts`, `status.ts` | `shared/lib/` |

## Rules for the moves

- One folder or one file group per PR, structure only: `refactor(...)` commits, tests change
  only their import paths (the structure guard fails the PR otherwise), baselines
  (`fast-coverage-baseline.json`, `apps/desktop/layout-baseline.json`, `src-size`) updated.
- A new `features/<x>`, `shared/<x>` or `app/` folder gets its `GLOSSARY.md` Domains row in the same PR.
- A file that two domains import is not moved into either: it goes to `shared/` first.
- Names in the table are the proposal. When a move finds the file belongs elsewhere (the
  importers say so), the PR fixes this table in the same commit.
- Order: shared primitives first (`shared/feedback`, `shared/markdown`, `shared/status`,
  `shared/layout`), then each domain from the smallest to the largest, `app/` last.
