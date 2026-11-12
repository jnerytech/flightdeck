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
  `feedback`, `status` and `markdown` there is one PR per folder (each adds its `index.ts`; a
  `shared/` folder is not a domain, so it gets no `GLOSSARY.md` row: the domain-glossary guard
  reads only the `features/` folders).
- `shared/` may import `components/ui/` and `lib/utils.ts` (`cn`), the two domain-free leaves that stay where
  they are; the depcruise rule `shared-depends-on-no-domain` allows them and nothing else outside
  `shared/` (decision of fd-coordinator, 2026-11-12). `bun run arch` now cruises `apps/desktop/src`, so
  the rule gates the desktop too.
- Widened by fd-coordinator's ack of #2126 (2026-11-12): `shared/` may also import `i18n/context.tsx`
  (the translation hook, domain-free) and `hooks/use-in-flight.ts` (the in-flight stage hook), which the
  feedback and layout primitives need. `components/layout/form.tsx` was a third exception only until the
  layout move (the field-row context now lives in `shared/layout/field-row-context.ts`, a leaf). The three
  helpers `lib/list-width.ts`, `lib/use-width.ts` and `lib/scroll-edge.ts` were allowed only until the
  `shared/lib/` move (they live there now, so that entry is gone). Each exception is a path in the rule, so
  it shows in `.dependency-cruiser.cjs`.
- `components/ui/` **stays**: it is the vendored shadcn folder (`components.json` alias,
  Biome override, knip and coverage exclusions all name it), and the shadcn CLI writes there.
- `hooks/` is outside the three folders this map covers; a hook follows its domain the same way.
  **Moved** (#1597): `use-project-cards` to `features/projects/`, `use-switcher-hosts` to
  `features/hosts/` (with its `switcher-hosts.ts`, the pure rule that left `tabs/tab-scope.ts`, so hosts no
  longer reads the tabs) and `use-start-elsewhere` to `features/sessions/`, each behind its index. Two stay in
  `hooks/` for now: `use-project-labels` (it reads the costs index, which reaches the store) and
  `use-start-ask` (it reads the board index, which reaches the projects and sessions indexes): moving them
  adds import cycles, and the cycle count only goes down (#1624). The domain-free hooks (`use-busy`, `use-breakpoint`, `use-in-flight` and the rest) stay in `hooks/` too.
- Hooks that only one feature reads moved into it (#1597): `use-move-focus` to `features/board/`,
  `use-board-transition` to `features/activity/` and `use-now` to `features/hosts/`, each imported by file
  from inside its own folder.

## `components/`

| Entry | Target | Note |
|---|---|---|
| `approval/` | `features/permissions/` | the approval card, hold button and question form belong to the permission flow; `approval-lines.ts` and `gate-text.tsx` go with it. **theirs** if fd-frontend needs the card for the session view: ask before moving |
| `assistant/` | `features/assistant/` (new domain, GLOSSARY row) | the wand, model picker and keys; `refusal-text.ts` goes with it |
| `feedback/` | `shared/feedback/` | **moved**: `action-button`, `busy`, `confirm-dialog`, `dialog-content`, `icon-action-button`, `icon-tip`, `inline-notice`. `notices.tsx` stays in `components/feedback/` until the store moves: it reads `AppStore`, so it is not domain-free; it goes to `app/` with the root |
| `layout/` | `shared/layout/` | **moved** (14 primitives, behind an `index.ts`; the field-row context is a leaf, `field-row-context.ts`, that `shared/feedback` imports directly); `app-shell.tsx` and `breadcrumb.tsx` went to `features/shell/` (below); `view-toggle.tsx` went to `features/sessions/` (**moved**, exported from its index: the sessions hub and the history list use it, and it reads `lib/hub.ts`) |
| `markdown/` | `shared/markdown/` | **moved**: `markdown.tsx` and the lazy `markdown-body.tsx`; the `index.ts` exports only `Markdown` and `preloadMarkdown`, never the body, so the lazy chunk stays lazy (`bundle-reach` green) |
| `notifications/` | `notification-prefs.tsx` to `features/notifications/` (**moved**, with `notify-policy.ts` and `notify-sound.ts` from `lib/`); `notification-center.tsx` to `features/inbox/` (**moved**) | the center's only importer is the inbox bell, and it reads `inbox.ts`, now in the same folder |
| `session/` | **theirs** (`features/sessions/`) | **moved**: activity line, message actions, parts, tool rows, finish dialogs (`session-finish.tsx`) |
| `settings/` | `features/settings/` | `diagnostics-panel.tsx` only |
| `shell/` | `features/shell/` (new domain, GLOSSARY row) | **moved** (account footer, quota bars, quota detail, scope menu, status bar, top bar, with `app-shell.tsx` and `breadcrumb.tsx` from `layout/`, behind an `index.ts`); `Sidebar.tsx`, `nav-icons.ts` and nine shell `lib/` files followed (rows below); `workspace.ts`, `density.ts` and `theme.ts` followed; `router.ts` follows later |
| `shortcuts/` | `features/shortcuts/` | `keycap.tsx` only (**moved**; the sheet already lives there) |
| `simple/` | `features/home/` (simple mode) | home, question and task views, settings view (**moved**); `SimpleApp.tsx` (**moved**, `simple-app.tsx`) |
| `status/` | `shared/status/` | meter, progress ring, status dot and text: **moved** (index exports `Meter`, `ProgressRing`, `StatusDot`, `StateTone`, `StatusText`) |
| `tabs/` | `features/tabs/` | overflow and switcher (**moved**; the tab bar already lives there); **theirs** if the session view needs the file, ask first |
| `ui/` | **stay** | vendored shadcn |
| `whatsnew/` | `features/appupdate/` (**moved**) | the "what's new" dialog is part of the update story |
| `nav-icons.ts` | `features/shell/` | **moved**: the sidebar and rail icons |

## `ui/`

| Entry | Target | Note |
|---|---|---|
| `App.tsx` | `app/` (new, with `main.tsx` wiring) | the root; moves last |
| `Areas.tsx` | `app/` | imports `Screen` from `Screens.tsx`: move it with or after `Screens.tsx` to avoid a cycle |
| `BoardView.tsx` | **theirs** (`features/board/`) | **moved** (`board-view.tsx`) |
| `ConfirmDialog.tsx` | `shared/feedback/` | **moved** (#2101 to `components/feedback/`, then with the folder) |
| `ExternalView.tsx` | **theirs** (`features/sessions/`) | **moved** (`external-session-view.tsx`) |
| `FirstRun.tsx` | `features/hosts/` | **moved** (#2093) |
| `FolderPicker.tsx` | `features/hosts/` | **moved** (it browses a host's folders and already used `AllowedFolders`; `hosts` is the lower domain, so plugins, projects, teleport, the new-session form and the screens import it from the `hosts` index without a file-level cycle; `hosts` and `projects` import each other's index, the one pair to watch) |
| `Markdown.tsx` | `components/markdown/`, then `shared/markdown/` | **moved** (#2099, then the `markdown/` folder) |
| `NewSessionForm.tsx` | **theirs** (`features/sessions/`) | **moved** (`new-session-form.tsx`) |
| `Screens.tsx` | `app/` | the lazy screen table; moves with `App.tsx`, after the features it loads are in place |
| `SessionTabs.tsx` | **theirs** (`features/tabs/`) | **moved**, to `features/sessions/session-tabs.tsx` |
| `SessionView.tsx` | **theirs** (`features/sessions/`) | **moved** (`session-view.tsx`) |
| `SessionsHub.tsx` | **theirs** (`features/sessions/`) | **moved** (`sessions-hub.tsx`) |
| `SetupPage.tsx` | `features/setup/` | **moved** (#2091) |
| `Sidebar.tsx` | `features/shell/` | **moved** as `sidebar.tsx`, unsplit (about 980 lines): split by reason to change (nav list, project tree, footer) in a later PR, not in the move |
| `StartScreen.tsx` | **theirs** (`features/sessions/`) | **moved** (`start-screen.tsx`) |
| `ToolCall.tsx` | **theirs** (`features/sessions/`) | **moved** (`tool-call.tsx`, `tool-call-body.tsx`) |
| `lazy-screen.ts` | `app/` | goes with `Screens.tsx` |
| `simple/SimpleApp.tsx` | `features/home/` | with `components/simple/` (**moved**, `simple-app.tsx`) |

## `lib/`

A file moves to the domain named in the row; `*` stands for the files that start with that
prefix. Tests move with their file in the same PR.

| Entries | Target |
|---|---|
| `app-store.ts`, `app-state.ts`, `use-store.ts`, `unique-keys.ts` | `app/` (the store is one slice per domain; slices already live in `features/*/store.ts` or `*-store.ts`, and each move shrinks this file) |
| `board*.ts`, `card-*.ts`, `conflict-radar.ts`, `file-changes.ts`, `review.ts`, `second-opinion.ts`, `word-diff.ts`, `diff.ts`, `pull-requests.ts`, `runs.ts` | **theirs** (`features/board/`) and `features/review/` for `file-changes`, `review`, `word-diff`, `diff`, `second-opinion`; **moved** so far: `board-bulk`, `board-card-keys`, `board-contracts`, `board-files`, `board-keys`, `board-select`, `board-shortcut`, `card-next-step`, `card-start-block` and `card-merge-pr` (as `card-merge-pr-model.ts`, because `card-merge-pr.tsx` already lives in the folder), the ones other domains read behind the board `index.ts` (the screen and its dialogs stay out of it so the board loads lazily) |
| `session-*.ts`, `hub*.ts`, `live-elsewhere.ts`, `start-elsewhere.ts`, `new-session-*.ts`, `turns.ts`, `tool-*.ts`, `history-tool.ts`, `finished.ts`, `hold.ts`, `awaiting-approval.ts`, `pending-text.ts`, `cache-timer.ts`, `tiles.ts`, `timing.ts`, `use-session-cost.ts`, `use-follow.ts`, `use-draft.ts`, `mode-menu.ts`, `model-menu.ts`, `prompt-menu.ts` | **theirs** (`features/sessions/`); **moved** so far: `session-activity`, `session-finish`, `session-images`, `session-key`, `session-label`, `session-state`, `session-views`, `hub`, `hub-title`, `finished`, `turns`, `tool-line`, `tool-input`, `live-elsewhere`, `start-elsewhere`, `new-session-host`, `new-session-prefs`, `history-tool`, `awaiting-approval`, `pending-text`, `cache-timer` (as `cache-timer-model.ts`, because `cache-timer.tsx` already lives in the folder), `tiles`, `timing`, `use-session-cost`, `use-follow`, `use-draft`, `mode-menu`, `model-menu`, behind the sessions `index.ts`. Three went elsewhere to keep the folders free of import cycles: `activity.ts` is the activity board's model (`features/activity/`), `hold.ts` goes with the approval buttons that use it (`features/permissions/`) and `prompt-menu.ts` with the `/` menu that shows it (`features/snippets/prompt-menu-model.ts`) |
| `approval.ts`, `ask-question.ts`, `vault-approval.ts` | `features/permissions/` (**moved**; `fields` and `shortPath` are exported by the index for `features/sessions` and `features/projects`; `vault-approval.ts` went to `features/vault/` instead: it implements the vault's `VaultPolicy` and `features/vault` calls it, so keeping it in `permissions` made a cycle between the two domains; `permissions/store.ts` takes the `VaultAnswer` type from the vault index) |
| `assistant.ts`, `assistant-prefs.ts` | `features/assistant/` (**moved**) |
| `automations.ts` | `features/automations/` (**moved**) |
| `check-loop.ts` | `features/board/`: its only reader is `check-loop-panel.tsx`, which lives there, so it goes with the board and not with `features/automations` |
| `backup-*.ts`, `drive-target.ts`, `google-config.ts`, `google-oauth.ts` | `features/backup/` (**moved**: `backup-bundle`, `backup-error`, `backup-schedule`, `backup-scheduler`, `backup-target`, `drive-target`; the index adds `BackupError` and `BackupScheduler`, and `backup-bundle` stays out of it, a lazy chunk. `google-config` and `google-oauth` moved in their own slice, with the security review, since only the backup uses them; the index adds `googleConfig` and the `GoogleConfig` type) |
| `notify-policy.ts`, `notify-sound.ts` | `features/notifications/` (**moved**) |
| `notify.ts` | `features/inbox/` (**moved**): it builds the system notification from an inbox entry (`describeRequest`), so moving it into `notifications` would make `notifications` and `inbox` import each other |
| `badge-icon.ts` | `platform/tauri/` (**moved**: a pure pixel helper with no imports, read only by `platform/tauri/index.ts`, so the platform adapter no longer reaches into `lib/`) |
| `notice-*.ts` | `notice-lifetime.ts` goes to `app/` with `notices.tsx` (it reads the `Notice` type and the store; **moved**: `notice-lifetime.ts` is the first file in `app/`, read by `components/feedback/notices.tsx` and `lib/app-store.ts`; `notices.tsx` stays in `components/feedback`, because a feature may not import `app/` and features read it); `notice-text.ts` (`reasonText`, used by the board, needs-you and the run timeline) stays until `i18n` has a home |
| `incident-text.ts` | **theirs** (`features/board/`, only `post-mortem.tsx` reads it) |
| `quiet*.ts` | `features/needs-you/` (**moved**; the quiet badge of the board and the needs-you rows) |
| `away.ts` | `features/needs-you/` (**moved**) |
| `keep-awake.ts` | `features/hosts/` (**moved**, `holdAwake` behind the hosts index) |
| `breadcrumb.ts`, `nav-active.ts`, `nav-badges.ts`, `sidebar-*.ts`, `tree-fold.ts`, `shell-prefs.ts`, `status-bar.ts`, `foot-account.ts`, `router.ts`, `workspace.ts`, `density.ts`, `theme.ts`, `whats-new.ts` | `features/shell/` (`whats-new.ts` to `features/appupdate/`, **moved**; `router.ts` to `app/`). **Moved**: `breadcrumb.ts` as `crumbs.ts` and `status-bar.ts` as `status-bar-summary.ts` (the component files `breadcrumb.tsx` and `status-bar.tsx` already sit there), `nav-active.ts`, `nav-badges.ts`, `sidebar-fold.ts`, `sidebar-groups.ts`, `tree-fold.ts`, `shell-prefs.ts`, `foot-account.ts`, `workspace.ts`, `density.ts`, `theme.ts`. Still in `lib/`: `router.ts` (target `app/`, last, but about 35 files under `features/` import its `Route` type and `features/tabs` and `features/shell` import `Router` and `homeRoute` at runtime, and no feature may import `app/`; moving it to `features/shell/` would bring back the `shell` -> `tabs` -> `shell` cycle. It stays in `lib/` until that rule or the route type's home is settled; agreed with the coordinator, #1597). `tree-fold.ts` serves the project tree too, so it may move to `features/projects/` when that domain is cut |
| `client*.ts`, `costs*.ts`, `data-scope.ts`, `usage-rows.ts`, `measures.ts` | `features/clients/` for `client*.ts`; `features/costs/` for the rest, except `measures.ts`, which goes to `app/` with `router.ts` (**moved**: `client-costs`, `client-rules` (as `client-rules-model.ts`, because `client-rules.tsx` already lives in the folder), `client-scope`, `client-suggest`, `client-switcher` (as `client-switcher-model.ts`, for the same reason), `client-vault` and `clients`, behind the clients `index.ts`; `costs`, `costs-csv`, `costs-export`, `data-scope`, `usage-rows`; `measures.ts` stays in `lib/` because `router.ts` calls it and the e2e Node chain (`demo/boot.ts`) cannot reach the costs index, whose wire file reads `package.json`; the index adds their public names, and `usage-rows`' `projectLabel` is exported as `usageProjectLabel` because `costs`' `projectLabel` is a different function) |
| `deps*.ts` | `deps-summary.ts` to `features/deps/` (**moved**); `deps.ts` (`chainOf`, `pickable`: a card's dependency chain) belongs to `features/board/`, its only reader is `card-deps.tsx` |
| `harness.ts` | `features/harness/`: **moved** |
| `home-*.ts`, `simple-*.ts` | `features/home/` (**moved**: `home-cache`, `home-kpis`, `home-leaders`, `simple-mode`, `simple-task`, `simple-words`, and `home-view` as `home-view-model.ts`, because `home-view.tsx` already lives in the folder; the index adds `HomeCache` and the simple-mode choice helpers and `UiMode`) |
| `host-*.ts`, `hosts.ts`, `probe-host.ts`, `pairing-*.ts`, `request-link.ts`, `relay.ts`, `version.ts`, `setup-steps.ts` | `features/hosts/` (`setup-steps.ts` to `features/setup/`; `host-*.ts`, `hosts.ts`, `probe-host.ts`, `pairing-*.ts`, `request-link.ts`, `relay.ts` and `setup-steps.ts` **moved**; `version.ts` **stays in `lib/`**: about 80 files from every domain read `APP_VERSION` and `isNewer`, so moving it would make each of them depend on `hosts` for the app's own version, and the hosts index would then sit between the e2e Node chain and `package.json`; it goes with the shell files to `app/`; `host-*.ts` and `hosts.ts`, where `host-compare.ts` and `host-overview.ts` became `host-compare-model.ts` and `host-overview-model.ts` because `host-compare.tsx` and `host-overview.tsx` already live in the folder) |
| `inbox.ts` | `features/inbox/` (**moved**) |
| `issues.ts` | `features/issues/` (**moved**) |
| `frontmatter.ts`, `mcp-form.ts` | `features/agentcfg/` (**moved**) |
| `github-session.ts` | `features/hosts/` (the GitHub panel; **moved**, `githubSignedIn` and `GithubHost` behind the hosts index) |
| `grid-keys.ts`, `keys.ts`, `shortcut.ts`, `shortcuts.ts` | `features/shortcuts/` (**moved**; `board-shortcut.ts` stays with the board) |
| `palette.ts` | `features/palette/` (**moved**) |
| `project-*.ts` | `features/projects/` (**moved**: `project-cards`, `project-keys`, `project-suggestions` and `project-tree` as `project-tree-model.ts`, because `project-tree.tsx` already lives in the folder; the index adds the cards, the keys and the tree model's public names) |
| `quota.ts`, `quota-glance.ts` | `features/quota/` (**moved**; the panel, the shell bars, the costs quota charts and the board bulk actions read them through the index) |
| `recap-preview.ts`, `summary*.ts` | `features/summary/` (**moved**: `recap-preview.ts`, read only by the recap panel in the same folder; no `summary*.ts` file is left in `lib/`) |
| `roi*.ts` | `features/roi/` (**moved**; `RoiSettingsError` is exported by the index for `features/clients`) |
| `snippets.ts` | `features/snippets/`: **moved** (`prompt-menu.ts`, moved from the sessions row, is its `prompt-menu-model.ts`) |
| `tab-*.ts`, `tabs.ts`, `reveal-tab.ts` | `features/tabs/` (**moved**; the shell and hosts import by file to avoid an index cycle, settings reads the `TabOrder` type through the index. These deep imports break the "other domains import only the index" rule on purpose: `features/shell/nav-active.ts` (`tab-badge.ts`), `features/shell/workspace.ts` and `features/hosts/host-tabs.ts` (`tabs.ts`). The tab strip imports the shell and hosts indexes, so an index import back would close shell, then `tabs/index`, then shell, and the shell loaded first would throw `NAV_ICONS` before initialization (#2266). Undo them only after `tab-facts` stops reading the shell and hosts indexes at load time) |
| `teleport.ts` | `features/teleport/`: **moved** |
| `terminal*.ts`, `xterm-*.ts`, `use-launch-terminal.ts` | `features/terminal/` (**moved**; public names through its index) |
| `trace.ts` | `features/trace/`: **moved** |
| `tray.ts` | `features/tray/`: **moved** |
| `vault*.ts` | `features/vault/` (**moved**, `vault-approval.ts` included; `vault-backup.ts` stays out of the index because it imports `age`, and `features/backup/backup-bundle.ts`, a lazy chunk, imports it from the file) |
| `watch-*.ts` | `features/watch/` (**moved**) |
| `webhook*.ts` | `features/webhook/`: **moved** |
| `app-log.ts`, `kernel.ts` | `app/`, but both stay in `lib/` for now: features import them (`kernel.ts`: the `AppKernel` type, in the `wire.ts` of about 25 features; `app-log.ts`: `diagnosticsText` in `features/settings` and `LogLevel` in `features/appupdate`), and no feature may import `app/` |
| `backoff.ts`, `format-bytes.ts`, `paths.ts`, `file-language.ts`, `contrast.ts`, `status.ts`, `list-width.ts`, `use-width.ts`, `scroll-edge.ts` | `shared/lib/` (**moved**, behind an `index.ts`; the last three are used by `shared/layout`). `lib/utils.ts` (`cn`) **stays** in `lib/` per the #1597 decision; `host-connection.ts` imports `shared/lib/backoff.ts` by a relative path because the daemon's heartbeat test loads it and the daemon tsconfig has no `@/` alias |

## Rules for the moves

- One folder or one file group per PR, structure only: `refactor(...)` commits, tests change
  only their import paths (the structure guard fails the PR otherwise), baselines
  (`fast-coverage-baseline.json`, `apps/desktop/layout-baseline.json`, `src-size`) updated.
- A new `features/<x>` folder gets its `GLOSSARY.md` Domains row in the same PR; `shared/<x>` and `app/` are not domains and get none.
- A file that two domains import is not moved into either: it goes to `shared/` first.
- Names in the table are the proposal. When a move finds the file belongs elsewhere (the
  importers say so), the PR fixes this table in the same commit.
- Order: shared primitives first (`shared/feedback`, `shared/markdown`, `shared/status`,
  `shared/layout`), then each domain from the smallest to the largest, `app/` last.
