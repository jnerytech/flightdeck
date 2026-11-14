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
  (the translation hook, domain-free), which the feedback and layout primitives need; the in-flight stage
  hook they also need moved into `shared/hooks/` (#1597), so that exception is gone. `components/layout/form.tsx` was a third exception only until the
  layout move (the field-row context now lives in `shared/layout/field-row-context.ts`, a leaf). The three
  helpers `lib/list-width.ts`, `lib/use-width.ts` and `lib/scroll-edge.ts` were allowed only until the
  `shared/lib/` move (they live there now, so that entry is gone). Each exception is a path in the rule, so
  it shows in `.dependency-cruiser.cjs`.
- `components/ui/` **stays**: it is the vendored shadcn folder (`components.json` alias,
  Biome override, knip and coverage exclusions all name it), and the shadcn CLI writes there.
- `hooks/` is outside the three folders this map covers; a hook follows its domain the same way.
  **Moved** (#1597): `use-project-cards` to `features/projects/`, `use-switcher-hosts` to
  `features/hosts/` (with its `switcher-hosts.ts`, the pure rule that left `tabs/tab-scope.ts`, so hosts no
  longer reads the tabs) and `use-start-elsewhere` to `features/sessions/`, each behind its index, and `use-start-ask` to `features/board/` behind a new `ui.ts` (#1597, 2026-11-13: it holds the
  board's contract dialog, so it is not in the lazy-free `index.ts`). One stays in `hooks/` for now:
  `use-project-labels` (it reads the costs index, which reaches the store): moving it
  adds import cycles, and the cycle count only goes down (#1624).
- Hooks that only one feature reads moved into it (#1597): `use-move-focus` to `features/board/`,
  `use-board-transition` to `features/activity/` and `use-now` to `features/hosts/`, each imported by file
  from inside its own folder.
- Hooks with no domain moved to `shared/hooks/` behind an `index.ts` (#1597, fd-coordinator, 2026-11-12):
  `use-busy`, `use-min-loading`, `use-in-flight`, `use-breakpoint`, `use-media-query`, `use-page-focus` and
  `real-timers`.

## `components/`

| Entry | Target | Note |
|---|---|---|
| `approval/` | `features/permissions/` | the approval card, hold button and question form belong to the permission flow; `approval-lines.ts` and `gate-text.tsx` go with it. **theirs** if fd-frontend needs the card for the session view: ask before moving |
| `assistant/` | `features/assistant/` (new domain, GLOSSARY row) | the wand, model picker and keys; `refusal-text.ts` goes with it |
| `feedback/` | `shared/feedback/` | **moved**: `action-button`, `busy`, `confirm-dialog`, `dialog-content`, `icon-action-button`, `icon-tip`, `inline-notice`. `notices.tsx` was left in `components/feedback/` because it reads `AppStore`, so it is not domain-free; **moved** to `features/shell/notices.tsx` (#1597, fd-coordinator, 2026-11-13): it is the toast host of the app frame, shared through `features/shell/ui.ts` |
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
| `App.tsx` | `app/` (new, with `main.tsx` wiring) | the root; moved (#1597), its tests import it from `app/App.tsx` |
| `Areas.tsx` | `app/` | moved (#1597): it imports `Screen` from `app/Screens.tsx` |
| `BoardView.tsx` | **theirs** (`features/board/`) | **moved** (`board-view.tsx`) |
| `ConfirmDialog.tsx` | `shared/feedback/` | **moved** (#2101 to `components/feedback/`, then with the folder) |
| `ExternalView.tsx` | **theirs** (`features/sessions/`) | **moved** (`external-session-view.tsx`) |
| `FirstRun.tsx` | `features/hosts/` | **moved** (#2093) |
| `FolderPicker.tsx` | `features/hosts/` | **moved** (it browses a host's folders and already used `AllowedFolders`; `hosts` is the lower domain, so plugins, projects, teleport, the new-session form and the screens import it from the `hosts` index without a file-level cycle; `hosts` and `projects` import each other's index, the one pair to watch) |
| `Markdown.tsx` | `components/markdown/`, then `shared/markdown/` | **moved** (#2099, then the `markdown/` folder) |
| `NewSessionForm.tsx` | **theirs** (`features/sessions/`) | **moved** (`new-session-form.tsx`) |
| `Screens.tsx` | `app/` | the lazy screen table; **moved** (#1597, 2026-11-13) once the features it loads were in place, the last file of `src/ui/`, which is gone. Split first, one cut per PR (#1597): `ManagedSession` and its pin, fork and OpenCode-model hooks are in `features/sessions/managed-session.tsx`, `NewSession` and `startInBackground` in `features/sessions/new-session.tsx`, the Sessões split in `features/sessions/sessions-split.tsx` |
| `SessionTabs.tsx` | **theirs** (`features/tabs/`) | **moved**, to `features/sessions/session-tabs.tsx` |
| `SessionView.tsx` | **theirs** (`features/sessions/`) | **moved** (`session-view.tsx`) |
| `SessionsHub.tsx` | **theirs** (`features/sessions/`) | **moved** (`sessions-hub.tsx`) |
| `SetupPage.tsx` | `features/setup/` | **moved** (#2091) |
| `Sidebar.tsx` | `features/shell/` | **moved** as `sidebar.tsx`, unsplit (about 980 lines): split by reason to change (nav list, project tree, footer) in a later PR, not in the move |
| `StartScreen.tsx` | **theirs** (`features/sessions/`) | **moved** (`start-screen.tsx`) |
| `ToolCall.tsx` | **theirs** (`features/sessions/`) | **moved** (`tool-call.tsx`, `tool-call-body.tsx`) |
| `lazy-screen.ts` | `app/` | **moved** to `app/lazy-screen.ts` (#1597, 2026-11-13): it reads nothing but React, so it does not wait for `Screens.tsx`, its one reader |
| `simple/SimpleApp.tsx` | `features/home/` | with `components/simple/` (**moved**, `simple-app.tsx`) |

## `lib/`

A file moves to the domain named in the row; `*` stands for the files that start with that
prefix. Tests move with their file in the same PR.

| Entries | Target |
|---|---|
| `app-store.ts`, `app-state.ts`, `use-store.ts` | `app/` (the store is one slice per domain; slices already live in `features/*/store.ts` or `*-store.ts`, and each move shrinks this file) |
| `unique-keys.ts` | `shared/lib/` (**moved**, #1597, 2026-11-13: a pure helper that reads no store, used by four features, and a feature may not import `app/`) |
| `board*.ts`, `card-*.ts`, `conflict-radar.ts`, `file-changes.ts`, `review.ts`, `second-opinion.ts`, `word-diff.ts`, `diff.ts`, `pull-requests.ts`, `runs.ts` | **theirs** (`features/board/`) and `features/review/` for `file-changes`, `review`, `word-diff`, `diff`; **moved**: `file-changes` to `features/files/domain/` (#1601; its only source reader is `file-explorer.tsx`) and `diff` (`toolDiff`) to `features/permissions/` (its only source reader is `approval.ts`), not `review`, so neither needs a review entry, and `runs` to `features/runenv/` (not the board: its readers are `run-timeline.tsx` and, through the runenv index, `run-again.tsx`, and the board already reads runenv); **moved** so far: `conflict-radar`, `second-opinion` (it stays with the board, not `review`: its only readers are `card-second-opinion.tsx`, `card-work.tsx` and `card-run-form.tsx`), `pull-requests` (as `pull-requests-model.ts`, because `pull-requests.tsx` already lives in the folder), `incident-text` and `check-loop`, plus `board-bulk`, `board-card-keys`, `board-contracts`, `board-files`, `board-keys`, `board-select`, `board-shortcut`, `card-next-step`, `card-start-block`, `board.ts` (as `board-model.ts`, #1597, 2026-11-13: the column list and the card order rules; the project landing reads the protocol's `BoardColumn.options` instead, because `projects` importing the board index would add a cycle) and `card-merge-pr` (as `card-merge-pr-model.ts`, because `card-merge-pr.tsx` already lives in the folder), the ones other domains read behind the board `index.ts` (the screen and its dialogs stay out of it so the board loads lazily) |
| `session-*.ts`, `hub*.ts`, `live-elsewhere.ts`, `start-elsewhere.ts`, `new-session-*.ts`, `turns.ts`, `tool-*.ts`, `history-tool.ts`, `finished.ts`, `hold.ts`, `awaiting-approval.ts`, `pending-text.ts`, `cache-timer.ts`, `tiles.ts`, `timing.ts`, `use-session-cost.ts`, `use-follow.ts`, `use-draft.ts`, `mode-menu.ts`, `model-menu.ts`, `prompt-menu.ts` | **theirs** (`features/sessions/`); **moved** so far: `session-activity`, `session-finish`, `session-images`, `session-key`, `session-label`, `session-state`, `session-views`, `hub`, `hub-title`, `finished`, `turns`, `tool-line`, `tool-input`, `live-elsewhere`, `start-elsewhere`, `new-session-host`, `new-session-prefs`, `history-tool`, `awaiting-approval`, `pending-text`, `cache-timer` (as `cache-timer-model.ts`, because `cache-timer.tsx` already lives in the folder), `tiles`, `timing`, `use-session-cost`, `use-follow`, `use-draft`, `mode-menu`, `model-menu`, behind the sessions `index.ts`. Three went elsewhere to keep the folders free of import cycles: `activity.ts` is the activity board's model (`features/activity/domain/`, #1601), `hold.ts` goes with the approval buttons that use it (`features/permissions/`) and `prompt-menu.ts` with the `/` menu that shows it (`features/snippets/domain/prompt-menu-model.ts`) The pure rules among them (no store, React, storage or platform) sit in `features/sessions/domain/` (#1601). |
| `approval.ts`, `ask-question.ts`, `vault-approval.ts` | `features/permissions/` (**moved**; `fields` and `shortPath` are exported by the index for `features/sessions` and `features/projects`; `vault-approval.ts` went to `features/vault/` instead: it implements the vault's `VaultPolicy` and `features/vault` calls it, so keeping it in `permissions` made a cycle between the two domains; `permissions/store.ts` takes the `VaultAnswer` type from the vault index; the pure rules (`approval`, `approval-lines`, `ask-question`, `diff`, `hold`, `request-link`) sit in `features/permissions/domain/` (#1601), the store, the wiring and the components stay outside it) |
| `assistant.ts`, `assistant-prefs.ts` | `features/assistant/domain/` (**moved**; `wand-state.ts`, `word-diff.ts` and `refusal-text.ts` are there too) |
| `automations.ts` | `features/automations/` (**moved**), then `features/automations/domain/` (**moved**, #1601: pure, the translator is injected) |
| `check-loop.ts` | `features/board/`: its only reader is `check-loop-panel.tsx`, which lives there, so it goes with the board and not with `features/automations` |
| `backup-*.ts`, `drive-target.ts`, `google-config.ts`, `google-oauth.ts` | `features/backup/` (**moved**: `backup-bundle`, `backup-error`, `backup-schedule`, `backup-scheduler`, `backup-target`, `drive-target`; the index adds `BackupError` and `BackupScheduler`, and `backup-bundle` stays out of it, a lazy chunk. `google-config` and `google-oauth` moved in their own slice, with the security review, since only the backup uses them; the index adds `googleConfig` and the `GoogleConfig` type) |
| `notify-policy.ts`, `notify-sound.ts` | `features/notifications/` (**moved**), then the pure rules to `features/notifications/domain/` (**moved**, #1601): `notify-policy.ts` keeps the rules, the defaults and the stored-preferences reader; the `NotifyPreferences` class (it writes the storage) is `notify-preferences.ts` and `browserSound` (it reads the browser's globals) is `browser-sound.ts`, both beside the domain; the index re-exports the same names |
| `notify.ts` | `features/inbox/domain/` (**moved**): it builds the system notification from an inbox entry (`describeRequest`), so moving it into `notifications` would make `notifications` and `inbox` import each other |
| `badge-icon.ts` | `platform/tauri/` (**moved**: a pure pixel helper with no imports, read only by `platform/tauri/index.ts`, so the platform adapter no longer reaches into `lib/`) |
| `notice-*.ts` | `notice-lifetime.ts` goes to `app/` (it reads the `Notice` type and the store; **moved**: it is the first file in `app/`, read by `features/shell/notices.tsx` and `lib/app-store.ts`); `notice-text.ts` (`reasonText`, used by the board, needs-you and the run timeline) **moved** to `i18n/errors.ts` next to `translateError` (#1597, 2026-11-13): `shared/` may not import it (`shared-depends-on-no-domain`), and it only wraps `translateError` |
| `incident-text.ts` | **theirs** (`features/board/`, only `post-mortem.tsx` reads it) |
| `review.ts`, `word-diff.ts` | **moved**: `review.ts` to `features/review/`, then `features/review/domain/` (#1601); `word-diff.ts` to `features/assistant/`, not `features/review/` as the row above says: its only reader is `wand-controls.tsx`, so it needs no review entry and no assistant to review cycle |
| `quiet*.ts` | `features/needs-you/`, then `features/needs-you/domain/` (**moved**, #1601; the quiet badge of the board and the needs-you rows) |
| `away.ts` | `features/needs-you/`, then `features/needs-you/domain/` (**moved**, #1601): `AwayClock` and the quiet snooze slice take an injected storage and clock, so they are not strictly pure; they moved with their rules, as the clients and roi slices did |
| `keep-awake.ts` | `features/hosts/` (**moved**, `holdAwake` behind the hosts index) |
| `breadcrumb.ts`, `nav-active.ts`, `nav-badges.ts`, `sidebar-*.ts`, `tree-fold.ts`, `shell-prefs.ts`, `status-bar.ts`, `foot-account.ts`, `router.ts`, `workspace.ts`, `density.ts`, `theme.ts`, `whats-new.ts` | `features/shell/` (`whats-new.ts` to `features/appupdate/`, **moved**; `router.ts` to `app/`). **Moved**: `breadcrumb.ts` as `crumbs.ts` and `status-bar.ts` as `status-bar-summary.ts` (the component files `breadcrumb.tsx` and `status-bar.tsx` already sit there), `nav-active.ts`, `nav-badges.ts`, `sidebar-fold.ts`, `sidebar-groups.ts`, `tree-fold.ts`, `shell-prefs.ts`, `foot-account.ts`, `workspace.ts`, `density.ts`, `theme.ts`. Still in `lib/`: `router.ts` (target `app/`, last, but about 35 files under `features/` import its `Route` type and `features/tabs` and `features/shell` import `Router` and `homeRoute` at runtime, and no feature may import `app/` (one exception: `features/shell/notices.tsx` reads `app/notice-lifetime.ts`, a pure toast-timing file); moving it to `features/shell/` would bring back the `shell` -> `tabs` -> `shell` cycle. It stays in `lib/` until that rule or the route type's home is settled; agreed with the coordinator, #1597). `tree-fold.ts` serves the project tree too, so it may move to `features/projects/` when that domain is cut |
| `client*.ts`, `costs*.ts`, `data-scope.ts`, `usage-rows.ts`, `measures.ts` | `features/clients/` for `client*.ts`; `features/costs/` for the rest, except `measures.ts`, which goes to `app/` with `router.ts` (**moved**: `client-costs`, `client-rules` (as `client-rules-model.ts`, because `client-rules.tsx` already lives in the folder), `client-scope`, `client-suggest`, `client-switcher` (as `client-switcher-model.ts`, for the same reason), `client-vault` and `clients`, behind the clients `index.ts` (the pure rules `client-rules-model`, `client-scope`, `client-suggest`, `client-switcher-model`, `client-vault` and `clients` sit in `features/clients/domain/` (#1601); `client-costs` stays outside it because it asks the hosts, as do the stores and the components); `costs`, `costs-csv`, `costs-export`, `data-scope`, `usage-rows`; `measures.ts` stays in `lib/` because `router.ts` calls it and the e2e Node chain (`demo/boot.ts`) cannot reach the costs index, whose wire file reads `package.json`; the index adds their public names, and `usage-rows`' `projectLabel` is exported as `usageProjectLabel` because `costs`' `projectLabel` is a different function; the pure rules (`budgets`, `client-budgets`, `costs`, `costs-csv`, `costs-derive`, `costs-scope`, `data-scope`, `usage-rows`) sit in `features/costs/domain/` (#1601), the stores, the wiring, `costs-export` and the components stay outside it) |
| `deps*.ts` | `deps-summary.ts` to `features/deps/domain/` (**moved**); `deps.ts` (`chainOf`, `pickable`: a card's dependency chain) belongs to `features/board/` (**moved**), its only reader is `card-deps.tsx` |
| `harness.ts` | `features/harness/domain/`: **moved** |
| `home-*.ts`, `simple-*.ts` | `features/home/` (**moved**: `home-cache`, `home-kpis`, `home-leaders`, `simple-mode`, `simple-task`, `simple-words`, and `home-view` as `home-view-model.ts`, because `home-view.tsx` already lives in the folder; the index adds `HomeCache` and the simple-mode choice helpers and `UiMode`; the pure rules (`home-cache`, `home-kpis`, `home-leaders`, `home-view-model`, `simple-mode`, `simple-task`, `simple-words`) sit in `features/home/domain/` (#1601), the page and the components stay outside it) |
| `host-*.ts`, `hosts.ts`, `probe-host.ts`, `pairing-*.ts`, `request-link.ts`, `relay.ts`, `version.ts`, `setup-steps.ts` | `features/hosts/` (`setup-steps.ts` to `features/setup/`, then `features/setup/domain/` (#1601; `probes.ts` stays: it sends requests through the injected core); `host-*.ts`, `hosts.ts`, `probe-host.ts`, `pairing-*.ts`, `request-link.ts`, `relay.ts` and `setup-steps.ts` **moved** (`request-link.ts` later to `features/permissions/`, #1596: the link opens a permission request, and the next step moves the store's open-request handling into the permissions slice; `relay.ts` later to `features/messaging/domain/`, #1596: it is the messaging's work, and the next step moves the store's relay wiring into the messaging slice, which cannot import the hosts entry because that entry exports screens); `version.ts` **stays in `lib/`**: about 80 files from every domain read `APP_VERSION` and `isNewer`, so moving it would make each of them depend on `hosts` for the app's own version, and the hosts index would then sit between the e2e Node chain and `package.json`; it goes with the shell files to `app/`; `host-*.ts` and `hosts.ts`, where `host-compare.ts` and `host-overview.ts` became `host-compare-model.ts` and `host-overview-model.ts` because `host-compare.tsx` and `host-overview.tsx` already live in the folder; `keep-awake`, `switcher-hosts`, `pairing-mask`, `pairing-text`, `host-health-rows` and `host-overview-model` later joined the other pure rules in `features/hosts/domain/`, #1601) |
| `inbox.ts` | `features/inbox/domain/` (**moved**) |
| `issues.ts` | `features/issues/domain/` (**moved**) |
| `frontmatter.ts`, `mcp-form.ts` | `features/agentcfg/domain/` (**moved**) |
| `github-session.ts` | `features/hosts/` (the GitHub panel; **moved**, `githubSignedIn` and `GithubHost` behind the hosts index) |
| `grid-keys.ts`, `keys.ts`, `shortcut.ts`, `shortcuts.ts` | `features/shortcuts/domain/` (**moved**; `board-shortcut.ts` stays with the board) |
| `palette.ts` | `features/palette/` (**moved**; the pure rules `palette` and `palette-route` sit in `features/palette/domain/` (#1601), the store, the section and the global search stay outside it) |
| `project-*.ts` | `features/projects/domain/` (**moved**: `project-cards`, `project-keys`, `project-suggestions` and `project-tree` as `project-tree-model.ts`, because `project-tree.tsx` already lives in the folder; the index adds the cards, the keys and the tree model's public names) |
| `quota.ts`, `quota-glance.ts` | `features/quota/domain/` (**moved**, the pure window, bar and glance rules; the panel, the shell bars, the costs quota charts and the board bulk actions read them through the index) |
| `recap-preview.ts`, `summary*.ts` | `features/summary/` (**moved**: `recap-preview.ts`, read only by the recap panel in the same folder; no `summary*.ts` file is left in `lib/`) |
| `roi*.ts` | `features/roi/domain/` (**moved**, the pure `roi`, `roi-table`, `roi-people` and `roi-settings` rules; `RoiSettingsError` is exported by the index for `features/clients`) |
| `snippets.ts` | `features/snippets/domain/`: **moved** with `prompt-menu-model.ts` (`prompt-menu.ts`, moved from the sessions row); `global-snippets.ts` stays in the feature folder because its clock fallback is an I/O global |
| `tab-*.ts`, `tabs.ts`, `reveal-tab.ts` | `features/tabs/` (**moved**; the pure rules `reveal-tab`, `tab-badge`, `tab-scope`, `tab-shortcut` and `tab-switcher` sit in `features/tabs/domain/` (#1601), `tabs.ts` (clock and timer), `tab-facts.ts` (icons) and the components stay outside it; the shell and hosts import by file to avoid an index cycle, settings reads the `TabOrder` type through the index. These deep imports break the "other domains import only the index" rule on purpose: `features/shell/nav-active.ts` (`domain/tab-badge.ts`), `features/shell/workspace.ts` and `features/hosts/host-tabs.ts` (`tabs.ts`). The tab strip imports the shell and hosts indexes, so an index import back would close shell, then `tabs/index`, then shell, and the shell loaded first would throw `NAV_ICONS` before initialization (#2266). Undo them only after `tab-facts` stops reading the shell and hosts indexes at load time) |
| `teleport.ts` | `features/teleport/`: **moved** |
| `terminal*.ts`, `xterm-*.ts`, `use-launch-terminal.ts` | `features/terminal/` (**moved**; public names through its index), then the pure `terminal.ts` (the launch rules) and `terminal-paths.ts` (the path finder) to `features/terminal/domain/` (**moved**, #1601); `terminal-view.ts` stays, its font and reader settings write the storage |
| `trace.ts` | `features/trace/domain/`: **moved** |
| `tray.ts` | `features/tray/`: **moved** |
| `vault*.ts` | `features/vault/` (**moved**, `vault-approval.ts` included; `vault-backup.ts` stays out of the index because it imports `age`, and `features/backup/backup-bundle.ts`, a lazy chunk, imports it from the file) |
| `watch-*.ts` | `features/watch/` (**moved**; the pure rules `watch-alerts` and `watch-settings` sit in `features/watch/domain/` (#1601), the store, the wiring and the components stay outside it) |
| `webhook*.ts` | `features/webhook/`: **moved** |
| `app-log.ts`, `kernel.ts` | `app/`; `app-log.ts` **moved** to `app/app-log.ts`: its `diagnosticsText` and `DiagnosticsInput` went to `features/settings/diagnostics-text.ts`, the only feature that used them, and the `LogLevel` type, the one name `features/appupdate` read, went to `shared/lib/log-level.ts`, so only the two app roots and `app/compose` import it now. `kernel.ts` stays in `lib/` for now: the `AppKernel` type is read in the `wire.ts` of about 25 features, and no feature may import `app/` (one exception: `features/shell/notices.tsx` reads `app/notice-lifetime.ts`) |
| `compose/` (`hosts.ts`, `lifecycle.ts`, `shell.ts`, `vault.ts`) | `app/compose/` | **moved** (#1597, 2026-11-13): the composition files that wire the features into the app store; only `lib/app-store.ts` imports them, and they import `lib/app-state.ts` and `lib/kernel.ts` |
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
