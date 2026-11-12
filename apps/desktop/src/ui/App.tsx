import { type Card, type ContractOverrides, parsePairingLink } from "@flightdeck/protocol";
import {
  type ComponentProps,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Notices } from "@/components/feedback/notices";
import { AppShell } from "@/components/layout/app-shell";
import { Breadcrumb } from "@/components/layout/breadcrumb";
import { StatusBarSlot } from "@/components/shell/status-bar";
import { HistoryButtons, TopBarActions, TopBarHost } from "@/components/shell/top-bar";
import { TabSwitcherHost } from "@/components/tabs/tab-switcher";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WhatsNewDialog } from "@/components/whatsnew/whats-new-dialog";
import { UpdateBanner, UpdateCard } from "@/features/appupdate/index.ts";
import { draftFromLink } from "@/features/hosts/index.ts";
import { NotificationBell } from "@/features/inbox/index.ts";
import { ResumeOfferDialog, useLiveElsewhereAsk } from "@/features/sessions/index.ts";
import { SnippetUse } from "@/features/snippets/index.ts";
import { useBreakpoint } from "@/hooks/use-breakpoint";
import { projectContracts, useStartAsk } from "@/hooks/use-start-ask";
import { TContext } from "@/i18n/context";
import { GlobalSearch, paletteRoute } from "../features/palette/index.ts";
import { ShortcutsSheet } from "../features/shortcuts/index.ts";
import { AskpassPrompt } from "../features/ssh/askpass-prompt.tsx";
import { tabIntent } from "../features/tabs/index.ts";
import { TerminalCloseDialog } from "../features/terminal/index.ts";
import type { AppStore, PendingItem } from "../lib/app-store.ts";
import { boardShortcut } from "../lib/board-shortcut.ts";
import { breadcrumb } from "../lib/breadcrumb.ts";
import { typing } from "../lib/keys.ts";
import { pairingErrorText } from "../lib/pairing-text.ts";
import type { PaletteTarget } from "../lib/palette.ts";
import { activeWorktreeFilter } from "../lib/project-tree.ts";
import type { Route } from "../lib/router.ts";
import { type ChordState, chordStep, isMac, NO_CHORD } from "../lib/shortcuts.ts";
import { firstTerminalTab, hostsRoute, terminalTabCount } from "../lib/status-bar.ts";
import { useStoreState } from "../lib/use-store.ts";
import { APP_VERSION } from "../lib/version.ts";
import { Areas } from "./Areas.tsx";
import { preloadMarkdown } from "./Markdown.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { SimpleApp } from "./simple/SimpleApp.tsx";

/** A card from an issue the palette named: by its full reference, else by its number in the project. */
async function createFromIssue(
  store: AppStore,
  target: Extract<PaletteTarget, { kind: "create-card-issue" }>,
) {
  const issueRef =
    target.ref ??
    (target.id
      ? (
          await store.hostCommand(target.hostId, "issues.get", {
            projectId: target.projectId,
            id: target.id,
          })
        )?.ref
      : undefined);
  return issueRef
    ? store.hostCommand(target.hostId, "issues.createCard", {
        projectId: target.projectId,
        issueRef,
      })
    : null;
}

/**
 * The tab shortcuts (Ctrl+T/W/Shift+T, Ctrl+Tab, Ctrl+1…9, Ctrl+Shift+PageUp/Down): true when the
 * key was one of them and has been handled.
 */
function tabShortcut(store: AppStore, e: KeyboardEvent): boolean {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const action = tabAction(store, key, e.shiftKey);
  action?.();
  return action !== null;
}

/** What a key does among the tab shortcuts; null when it is none of them. */
function tabAction(store: AppStore, key: string, shift: boolean): (() => void) | null {
  const { tabs } = store;
  const intent = tabIntent(key, shift);
  if (!intent) return null;
  switch (intent.kind) {
    case "toggle-split":
      return () => store.workspace.toggleSplit();
    case "reopen":
      return () => tabs.reopen();
    case "new":
      return () => {
        store.openNewTab();
        store.history.openSearch();
      };
    case "close":
      return () => store.closeTab(tabs, tabs.activeId);
    case "next-host":
      return () => store.hostTabs.next();
    case "previous-host":
      return () => store.hostTabs.previous();
    case "goto-host":
      return () => store.hostTabs.goto(intent.n);
    case "move":
      return () => {
        const index = tabs.tabs.findIndex((tab) => tab.id === tabs.activeId);
        tabs.move(tabs.activeId, index + intent.step);
      };
  }
}

/** Where each go-to chord leads. */
const CHORD_ROUTES: Record<string, Route> = {
  "go-sessions": { name: "hub" },
  "go-needs-you": { name: "needs-you" },
  "go-projects": { name: "all-projects" },
  "go-costs": { name: "costs" },
  "go-activity": { name: "activity" },
  "go-settings": { name: "settings" },
};

/** Ctrl+K, the tab shortcuts, Alt+Shift+C and Alt+←/→: what the whole app answers to. */
function windowShortcut(e: KeyboardEvent, store: AppStore): void {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (mod && key === "k") {
    e.preventDefault();
    store.history.openSearch();
  } else if (mod && tabShortcut(store, e)) {
    e.preventDefault();
  } else if (e.altKey && e.shiftKey && key === "c") {
    e.preventDefault();
    store.clientScope.next();
  } else if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
    e.preventDefault();
    if (e.key === "ArrowLeft") store.router.back();
    else store.router.forward();
  }
}

/** A key pressed anywhere in the window: simple mode, the go-to chords and `?`, then the shortcuts. */
function appKey(
  e: KeyboardEvent,
  store: AppStore,
  chord: { current: ChordState },
  showHelp: () => void,
): void {
  // Ctrl+Shift+M: simple mode and the full app, when the host lets the person choose.
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "m") {
    if (store.toggleUiMode()) e.preventDefault();
    return;
  }
  // The go-to chords and `?` (never while typing in a field).
  const step = chordStep(
    chord.current,
    {
      key: e.key,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      altKey: e.altKey,
      typing: typing(e.target),
    },
    Date.now(),
  );
  chord.current = step.state;
  if (step.consumed) e.preventDefault();
  if (step.action === "help") showHelp();
  else {
    const route = step.action ? CHORD_ROUTES[step.action] : undefined;
    if (route) store.router.push(route);
  }
  windowShortcut(e, store);
}

/** An action of the palette that is not a screen: done in place, else the target's route. */
export function runPaletteTarget(
  store: AppStore,
  target: PaletteTarget,
  ui: {
    lang: string;
    go(route: Route): void;
    showHelp(): void;
    askStart(card: Card, contracts: ContractOverrides, go: () => void): void;
    /** Runs `go` at once, or after asking when another terminal holds the conversation (#1705). */
    guardLive(hostId: string, claudeSessionId: string | null, go: () => void): void;
  },
): void {
  switch (target.kind) {
    case "terminal":
      ui.guardLive(target.hostId, target.target.claudeSessionId, () => {
        if (store.terminals.embedded(target.hostId)) {
          void store.terminals.openClaude(target.hostId, target.target);
        } else void store.terminals.openIn(target.hostId, target.target);
      });
      return;
    case "new-terminal":
      void store.terminals.open(target.hostId);
      return;
    case "session-view":
      store.sessionViews.select(target.view);
      return;
    case "toggle-theme":
      store.theme.toggle();
      return;
    case "toggle-ui-mode":
      store.toggleUiMode();
      return;
    case "switch-language":
      store.i18n.setLang(ui.lang === "pt-BR" ? "en" : "pt-BR");
      return;
    case "switch-client":
      store.clientScope.select(target.clientId);
      return;
    case "snippet":
      store.snippets.choose({ hostId: target.hostId, snippetId: target.snippetId });
      return;
    case "pull-link":
      void store.prWatch.openLink(target.url).then((route) => {
        if (route) ui.go(route);
      });
      return;
    case "create-card": {
      // Issue #147: text that matches no card becomes one in the project, and its board opens.
      const board: Route = { name: "board", host: target.hostId, projectId: target.projectId };
      void store
        .hostCommand(target.hostId, "card.create", {
          projectId: target.projectId,
          title: target.title,
          description: "",
        })
        .then((card) => {
          if (card) ui.go(board);
        });
      return;
    }
    case "start-session": {
      // Issue #1135: the typed text is the task; the mode and model are the form's last ones, and
      // the persona the client defaults to for that folder, as on the form.
      const { mode, model } = store.newSessionPrefs.value;
      const persona = store.personas.ref(
        store.clientScope.get().defaultPersona(target.hostId, target.cwd),
      );
      void store.createSession(target.hostId, {
        cwd: target.cwd,
        prompt: target.prompt,
        permissionMode: mode,
        ...(model ? { model } : {}),
        ...(persona ? { persona } : {}),
      });
      return;
    }
    case "create-card-issue": {
      const board: Route = { name: "board", host: target.hostId, projectId: target.projectId };
      void createFromIssue(store, target).then((card) => {
        if (card) ui.go(board);
      });
      return;
    }
    case "start-card": {
      // The same question as the card's own Start (issue #78): only where In progress confirms.
      const start = () =>
        void store.hostCommand(target.hostId, "card.start", { cardId: target.cardId });
      const card = store.getState().cards[`${target.hostId}/${target.cardId}`];
      if (card) ui.askStart(card, projectContracts(store, target.hostId, card.projectId), start);
      else start();
      return;
    }
    case "shortcuts":
      ui.showHelp();
      return;
    case "decide-oldest":
      store.decideOldest(target.decision, target.key);
      return;
    default:
      ui.go(paletteRoute(target));
  }
}

/** The sidebar as the shell asks for it: a function of whether the rail is folded. */
const sidebarSlot =
  (props: Omit<ComponentProps<typeof Sidebar>, "collapsed">) => (collapsed: boolean) => (
    <Sidebar {...props} collapsed={collapsed} />
  );

export function App({ store }: Readonly<{ store: AppStore }>) {
  const state = useStoreState(store);
  const themeMode = useSyncExternalStore(store.theme.subscribe, () => store.theme.mode);
  const resolvedTheme = useSyncExternalStore(store.theme.subscribe, () => store.theme.resolved);
  const lang = useSyncExternalStore(store.i18n.subscribe, () => store.i18n.lang);
  const tabScope = useSyncExternalStore(store.tabScope.subscribe, () => store.tabScope.value);
  const sidebarFolded = useSyncExternalStore(
    store.sidebarFold.subscribe,
    () => store.sidebarFold.folded,
  );
  const compact = useBreakpoint() === "compact";
  const density = useSyncExternalStore(store.density.subscribe, () => store.density.value);
  const { router } = store;
  const route = useSyncExternalStore(router.subscribe, () => router.current);
  const { t } = store.i18n;
  /** The palette's Start card asks the same question as the card's own Start (issue #78). */
  const startAsk = useStartAsk({ t });
  /** The palette's terminal asks before a second `claude` on a conversation another terminal holds (#1736). */
  const liveAsk = useLiveElsewhereAsk(store);
  // The `?` sheet, and the first key of a go-to chord waiting for its second.
  const [help, setHelp] = useState(false);
  const [whatsNew, setWhatsNew] = useState(false);
  const chord = useRef<ChordState>(NO_CHORD);
  // The status bar (issue #491): the terminal tabs open, and the plan usage asked again.
  const terminalTabs = useSyncExternalStore(store.hostTabs.subscribe, () =>
    terminalTabCount(store.workspace),
  );
  const [refreshingQuota, setRefreshingQuota] = useState(false);
  const refreshQuota = async () => {
    setRefreshingQuota(true);
    try {
      await store.quota.refresh();
    } finally {
      setRefreshingQuota(false);
    }
  };
  /** The first terminal tab is brought forward; with none open, the host where one can be opened. */
  const openTerminals = () => {
    const found = firstTerminalTab(store.workspace);
    if (!found) return go(hostsRoute(state.hosts, store.uiHostId()));
    store.workspace.focusArea(found.area);
    store.hostTabs.activate(found.id);
  };

  // The header's path names the project of a board, a card or workflows: load the host's projects
  // when the screen was opened without passing through them (a link, a card of the queue).
  const projectHost =
    route.name === "board" ||
    route.name === "card" ||
    route.name === "workflows" ||
    route.name === "automations" ||
    route.name === "actions"
      ? route.host
      : null;
  const projectsKnown = projectHost === null || state.projects[projectHost] !== undefined;
  const projectHostOnline = state.hosts.some((h) => h.id === projectHost && h.status === "online");
  useEffect(() => {
    if (projectHost && !projectsKnown && projectHostOnline)
      void store.projectList.load(projectHost);
  }, [store, projectHost, projectsKnown, projectHostOnline]);

  /** Opening anything closes the layers above it: the palette (dialogs go with their screen). */
  const go = useCallback(
    (next: Route) => {
      store.history.closeSearch();
      router.push(next);
    },
    [store, router],
  );

  /** A single click on a sidebar item: the preview tab shows it (a regular one with ctrl or middle). */
  const goPreview = useCallback(
    (next: Route) => {
      store.history.closeSearch();
      store.hostTabs.openPreview(next);
    },
    [store],
  );
  /** Working in the screen (a click, a key, typing) turns the preview tab into a regular one. */
  const commitActive = useCallback(() => store.tabs.commit(store.tabs.activeId), [store]);

  useEffect(() => {
    void store.init();
    return () => store.dispose();
  }, [store]);

  // The Markdown renderer is a separate chunk: fetch it now so a conversation never opens as plain text.
  useEffect(preloadMarkdown, []);

  // Links come from anywhere: a pairing link only prefills the form (saving needs the user's
  // click); a request link (a notification click) shows the request.
  useEffect(
    () =>
      store.onDeepLink((url) => {
        if (store.openRequestLink(url)) return;
        const parsed = parsePairingLink(url);
        if (!parsed.ok) {
          const { t } = store.i18n;
          store.reportError(
            t("hostForm.pairRefused", { reason: pairingErrorText(t, parsed.error) }),
          );
          return;
        }
        const { url: wsUrl, name, token } = parsed.value;
        store.history.closeSearch();
        router.push({
          name: "add-host",
          draft: draftFromLink(wsUrl, name, token),
          key: Date.now(),
        });
      }),
    [store, router],
  );

  // The OS refused the global shortcut: show the warning where another one can be chosen.
  const shortcutProblem = state.settings.shortcutProblem;
  useEffect(() => {
    if (shortcutProblem) router.push({ name: "settings" });
  }, [shortcutProblem, router]);

  // Ctrl+K inside the app only (as a global shortcut it would clash with browsers and VS Code);
  // Alt+←/→ and the mouse's back and forward buttons walk the history.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => appKey(e, store, chord, () => setHelp(true));
    // Ctrl+click and the middle button open what was clicked in a new tab: the navigation of
    // that event goes to a new tab (the middle button fires no click, so it clicks for itself).
    const onNewTab = (e: MouseEvent) => {
      const middle = e.type === "auxclick";
      if (middle ? e.button !== 1 : !(e.ctrlKey || e.metaKey)) return;
      store.hostTabs.openNextInNewTab();
      if (!middle) return;
      e.preventDefault();
      (e.target as HTMLElement).closest<HTMLElement>("button, a, [role=button]")?.click();
    };
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) router.back();
      if (e.button === 4) router.forward();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mouseup", onMouse);
    window.addEventListener("click", onNewTab, true);
    window.addEventListener("auxclick", onNewTab, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mouseup", onMouse);
      window.removeEventListener("click", onNewTab, true);
      window.removeEventListener("auxclick", onNewTab, true);
    };
  }, [store, router]);

  /** A request from the queue, the tray or a notification: its session, card or terminal view. */
  const openRequest = (item: PendingItem) => {
    if (item.vault) {
      // A request for a secret has no session: it is answered in the queue.
      go({ name: "needs-you" });
      return;
    }
    if (item.gate) {
      // A gate opens its card, where it is answered inline.
      const { hostId } = item;
      void store.hostCommand(hostId, "card.get", { cardId: item.gate.cardId }).then((card) => {
        if (card) go({ name: "card", host: hostId, projectId: card.projectId, cardId: card.id });
      });
      return;
    }
    if (item.external) {
      go({ name: "external", host: item.hostId, claudeSessionId: item.sessionId });
      return;
    }
    go({ name: "session", host: item.hostId, id: item.sessionId, focus: item.requestId });
  };
  const openRequestRef = useRef(openRequest);
  openRequestRef.current = openRequest;
  useEffect(() => store.onOpenRequest((item) => openRequestRef.current(item)), [store]);

  /** Board or Workflows from the sidebar: the only project opens directly, several ask which. */
  const openProjectScreen = (hostId: string, kind: "board" | "workflows") => {
    void store.hostCommand(hostId, "project.list", {}).then((list) => {
      const projects = list?.projects ?? [];
      if (kind === "board") {
        // The worktree picked in the tree, the only project or the last board opened (#669).
        const projectId = boardShortcut({
          hostId,
          projectIds: projects.map((p) => p.id),
          worktree: activeWorktreeFilter(store.getState()),
          remembered: store.viewPrefs.lastBoard(hostId),
        });
        go(
          projectId
            ? { name: "board", host: hostId, projectId }
            : { name: "projects", host: hostId, focus: kind },
        );
        return;
      }
      const only = projects.length === 1 ? projects[0] : undefined;
      go(
        only
          ? { name: "workflows", host: hostId, projectId: only.id, projectName: only.name }
          : { name: "projects", host: hostId, focus: kind },
      );
    });
  };

  /** An entry or action of the Ctrl+K palette: its screen, or an action in place. */
  const goTo = (target: PaletteTarget) => {
    store.history.closeSearch();
    runPaletteTarget(store, target, {
      lang,
      go,
      showHelp: () => setHelp(true),
      askStart: startAsk.ask,
      guardLive: liveAsk.ask,
    });
  };

  // A host set to simple (or chosen so) shows simple mode in place of the full frame.
  const focusHost = state.hosts.find((h) => h.id === store.uiHostId());
  if (focusHost && store.uiMode(focusHost.id).mode === "simple") {
    return (
      <TContext.Provider value={t}>
        <TooltipProvider>
          <SimpleApp
            store={store}
            host={focusHost}
            notifyUpdates={state.settings.notifyUpdates}
            hostId={focusHost.id}
          />
        </TooltipProvider>
      </TContext.Provider>
    );
  }

  const history = (
    <HistoryButtons
      t={t}
      canBack={router.canBack}
      canForward={router.canForward}
      onBack={() => router.back()}
      onForward={() => router.forward()}
    />
  );
  return (
    <TContext.Provider value={t}>
      <TooltipProvider>
        <AppShell
          labels={{
            sidebar: t("shell.sidebar"),
            collapse: t("shell.collapse"),
            expand: t("shell.expand"),
            skip: t("shell.skip"),
          }}
          navKey={route}
          folded={sidebarFolded}
          onFold={(folded) => store.sidebarFold.set(folded)}
          drawerTop={compact ? history : undefined}
          header={
            <>
              <TopBarHost
                hosts={state.hosts.map((h) => ({
                  id: h.id,
                  name: h.name,
                  status: h.status,
                  version: h.hostInfo?.daemonVersion ?? null,
                }))}
                currentId={store.activeHostId() ?? store.uiHostId()}
                appVersion={APP_VERSION}
                t={t}
                onChoose={(hostId) => {
                  store.select(hostId, null);
                  store.hostTabs.switchHost(hostId);
                }}
                onAdd={() => go({ name: "add-host" })}
                allHosts={tabScope === "all"}
                onAllHosts={(on) => store.tabScope.set(on ? "all" : "host")}
              />
              {!compact && history}
              <Breadcrumb
                crumbs={breadcrumb(route, state, t)}
                label={t("shell.breadcrumb")}
                moreLabel={t("shell.breadcrumbMore")}
                onGo={go}
              />
            </>
          }
          actions={
            <TopBarActions
              t={t}
              theme={resolvedTheme}
              version={APP_VERSION}
              bell={<NotificationBell store={store} inbox={state.inbox} t={t} go={go} />}
              onSearch={() => store.history.openSearch()}
              onToggleTheme={() => store.theme.toggle()}
            />
          }
          status={
            <StatusBarSlot
              t={t}
              state={state}
              store={store}
              now={Date.now()}
              terminalTabs={terminalTabs}
              refreshing={refreshingQuota}
              currentHostId={store.uiHostId()}
              onRefreshQuota={() => void refreshQuota()}
              onOpenTerminals={openTerminals}
              go={go}
            />
          }
          sidebar={sidebarSlot({
            store,
            state,
            t,
            go: goPreview,
            route,
            onOpenProjectScreen: openProjectScreen,
            onNewSession: (hostId) => {
              store.select(hostId, null);
              go({ name: "new-session", host: hostId });
            },
            onRemoveHost: (id) => void store.roster.remove(id),
            onRenameHost: (id, name) => store.roster.rename(id, name),
            onOpenSearch: () => store.history.openSearch(),
            onNewTab: () => store.hostTabs.openNextInNewTab(),
            onToggleTheme: () => store.theme.toggle(),
            onShortcuts: () => setHelp(true),
            onWhatsNew: () => setWhatsNew(true),
            ...(focusHost && store.uiMode(focusHost.id).canSwitch
              ? {
                  onSimpleMode: () => {
                    void store.toggleUiMode(); // NOSONAR: the promise is deliberately not awaited; void says so
                  },
                }
              : {}),
          })}
        >
          <div
            className="flex h-full min-h-0 flex-col"
            onPointerDownCapture={commitActive}
            onKeyDownCapture={commitActive}
          >
            <UpdateBanner store={store} />
            <UpdateCard store={store} />
            <Areas
              store={store}
              state={state}
              screen={{
                store,
                state,
                theme: themeMode,
                density,
                go,
                onOpenRequest: openRequest,
              }}
            />
          </div>
          <Notices store={store} />
          {Object.entries(state.resumeOffers).map(([hostId, offer]) => {
            const host = state.hosts.find((h) => h.id === hostId);
            return offer.open && host ? (
              <ResumeOfferDialog
                key={hostId}
                store={store}
                hostId={hostId}
                hostName={host.name}
                sessions={offer.sessions}
                resumed={offer.resumed}
              />
            ) : null;
          })}
          <TabSwitcherHost store={store} />
          {state.closingTerminal && (
            <TerminalCloseDialog onClose={(kill) => void store.terminals.finishClose(kill)} />
          )}
          <AskpassPrompt store={store} />
          {startAsk.dialog}
          {liveAsk.dialog}
          {state.snippetChoice && (
            <SnippetUse
              store={store}
              choice={state.snippetChoice}
              onClose={() => store.snippets.choose(null)}
            />
          )}
          {whatsNew && <WhatsNewDialog store={store} onClose={() => setWhatsNew(false)} />}
          {help && (
            <ShortcutsSheet
              store={store}
              mac={isMac(typeof navigator === "undefined" ? undefined : navigator)}
              onClose={() => setHelp(false)}
            />
          )}
          {state.searchOpen && (
            <GlobalSearch
              state={state}
              store={store}
              costs={true}
              onGo={goTo}
              onSearch={(query) => void store.history.search(query)}
              onClose={() => store.history.closeSearch()}
              onOpenHit={(hit) =>
                go({
                  name: "reader",
                  target: {
                    hostId: hit.hostId,
                    claudeSessionId: hit.claudeSessionId,
                    cursor: hit.cursor,
                    focusUuid: hit.uuid,
                  },
                })
              }
            />
          )}
        </AppShell>
      </TooltipProvider>
    </TContext.Provider>
  );
}
