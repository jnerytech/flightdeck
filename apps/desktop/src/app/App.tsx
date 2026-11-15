import { parsePairingLink } from "@flightdeck/protocol";
import {
  type ComponentProps,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UpdateBanner, UpdateCard, WhatsNewDialog } from "@/features/appupdate/ui.ts";
import { useStartAsk } from "@/features/board/ui.ts";
import { SimpleApp } from "@/features/home/ui.ts";
import { draftFromLink, pairingErrorText } from "@/features/hosts/index.ts";
import { NotificationBell } from "@/features/inbox/ui.ts";
import { activeWorktreeFilter } from "@/features/projects/index.ts";
import { ResumeOfferDialog, useLiveElsewhereAsk } from "@/features/sessions/ui.ts";
import {
  breadcrumb,
  firstTerminalTab,
  hostsRoute,
  terminalTabCount,
} from "@/features/shell/index.ts";
import {
  AppShell,
  Breadcrumb,
  HistoryButtons,
  Notices,
  Sidebar,
  StatusBarSlot,
  TopBarActions,
  TopBarHost,
} from "@/features/shell/ui.ts";
import { SnippetUse } from "@/features/snippets/ui.ts";
import { TContext } from "@/i18n/context";
import { useBreakpoint } from "@/shared/hooks/index.ts";
import { preloadMarkdown } from "@/shared/markdown/index.ts";
import { boardShortcut } from "../features/board/index.ts";
import type { PaletteTarget } from "../features/palette/index.ts";
import { GlobalSearch } from "../features/palette/ui.ts";
import { isMac } from "../features/shortcuts/index.ts";
import { ShortcutsSheet } from "../features/shortcuts/ui.ts";
import { AskpassPrompt } from "../features/ssh/askpass-prompt.tsx";
import { TabSwitcherHost } from "../features/tabs/ui.ts";
import { TerminalCloseDialog } from "../features/terminal/ui.ts";
import type { AppStore, PendingItem } from "../lib/app-store.ts";
import type { Route } from "../lib/router.ts";
import { useStoreState } from "../lib/use-store.ts";
import { APP_VERSION } from "../lib/version.ts";
import { Areas } from "./Areas.tsx";
import { runPaletteTarget } from "./run-palette-target.ts";
import { useWindowKeys } from "./window-keys.ts";

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
  // The `?` sheet.
  const [help, setHelp] = useState(false);
  const showHelp = useCallback(() => setHelp(true), []);
  const [whatsNew, setWhatsNew] = useState(false);
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
    if (!found) return go(hostsRoute(state.hosts, store.uiModes.hostId()));
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
        if (store.permissions.openLink(url)) return;
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

  useWindowKeys(store, showHelp);

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
  useEffect(() => store.permissions.onOpen((item) => openRequestRef.current(item)), [store]);

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
  const focusHost = state.hosts.find((h) => h.id === store.uiModes.hostId());
  if (focusHost && store.uiModes.mode(focusHost.id).mode === "simple") {
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
                currentId={store.activeHostId() ?? store.uiModes.hostId()}
                appVersion={APP_VERSION}
                t={t}
                onChoose={(hostId) => {
                  store.subscriptions.select(hostId, null);
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
              currentHostId={store.uiModes.hostId()}
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
              store.subscriptions.select(hostId, null);
              go({ name: "new-session", host: hostId });
            },
            onRemoveHost: (id) => void store.roster.remove(id),
            onRenameHost: (id, name) => store.roster.rename(id, name),
            onOpenSearch: () => store.history.openSearch(),
            onNewTab: () => store.hostTabs.openNextInNewTab(),
            onToggleTheme: () => store.theme.toggle(),
            onShortcuts: () => setHelp(true),
            onWhatsNew: () => setWhatsNew(true),
            ...(focusHost && store.uiModes.mode(focusHost.id).canSwitch
              ? {
                  onSimpleMode: () => {
                    void store.uiModes.toggle(); // NOSONAR: the promise is deliberately not awaited; void says so
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
