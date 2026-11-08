# The layout journey is cut to fit 90 s, and three flaky journeys are gone (issue #1003)

**Decision (the person, 2026-11-08, relayed by fd-coordinator):** delete flaky and too-slow tests. On the ubuntu runner a test over 5 s, a file over 60 s and an e2e journey over 90 s are too slow. The `layout` journey took 333 s (en) and 187 s (pt-BR) with a 20 minute timeout of its own; it is kept, cut to fit the 90 s every journey gets.

**What `layout` checks now.**
- The geometry guards (#192) on Home, a session, the board, a host's page and Settings, at 360x480 (the smallest window the app allows) and 1280x800, in both languages (pt-BR keeps its longer texts under the guards).
- English only, besides: a long session at the smallest and the largest window with 12 tabs (no sideways scroll, crumbs inside their box), the tab widths and the tab list at the smallest window, the active tab (#488), the tab strip's start, the one-scroll rule of the sidebar and the Page area (#567, #785), a session pinned at its end (#173), the message box at 720x480 (#135), and the bell's panel (#137).
- The journey's own `setTimeout` is gone: it gets the default 90 s.

**What it does not check any more.** The other screens (Needs you, Costs, Activity, Clients, Agent, History), the 760, 1024 and 1919 px windows for them, the split's tab-bar height (#225), the Needs you row's cut line (#175), the sidebar's hosts section height (#171), the summary card over the conversation (#135 recap), the folder dialog, the `/` menu and the end of the hosts list at small windows. Whoever sees one of these regress adds a fast component test of it.

**Deleted flaky journeys:** `rolagem-fim` (scroll settle; `sessao-rolagem-fim` tests the behavior), `abas-terminal` (a Ctrl+click and a terminal with a real shell; `session-terminal-ui`, `terminal-ui-*` and the `abas-*` tests cover the views, the shell, the scrollback and the split) and `acoes` (the Trust dialog that did not show; `acoes-ui-confianca` covers Trust). The demo still seeds the actions the `acoes` journey used.
