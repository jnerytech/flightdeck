import { parsePairingLink } from "@flightdeck/protocol";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { AskpassPrompt } from "@/components/connections/askpass-prompt";
import { Notices } from "@/components/feedback/notices";
import { AppShell } from "@/components/layout/app-shell";
import { Breadcrumb } from "@/components/layout/breadcrumb";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TContext } from "@/i18n/context";
import type { AppStore, PendingItem } from "../lib/app-store.ts";
import { breadcrumb } from "../lib/breadcrumb.ts";
import type { PaletteTarget } from "../lib/palette.ts";
import type { Route } from "../lib/router.ts";
import { Areas } from "./Areas.tsx";
import { GlobalSearch } from "./GlobalSearch.tsx";
import { draftFromLink } from "./HostForm.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { TerminalCloseDialog } from "./TerminalPage.tsx";
import { UpdateBanner } from "./UpdateBanner.tsx";

/** The palette's targets that act in place instead of opening a screen. */
type InPlace = "terminal" | "new-terminal" | "toggle-theme" | "switch-language" | "start-card";

/** The screen of a palette target that opens one. */
function paletteRoute(target: Exclude<PaletteTarget, { kind: InPlace }>): Route {
  switch (target.kind) {
    case "session":
      return { name: "session", host: target.hostId, id: target.sessionId };
    case "new-session":
      return { name: "new-session", host: target.hostId };
    case "external":
      return { name: "external", host: target.hostId, claudeSessionId: target.claudeSessionId };
    case "card":
      return {
        name: "card",
        host: target.hostId,
        projectId: target.projectId,
        cardId: target.cardId,
      };
    case "board":
      return { name: "board", host: target.hostId, projectId: target.projectId };
    case "workflows":
      return {
        name: "workflows",
        host: target.hostId,
        projectId: target.projectId,
        projectName: target.name,
      };
    case "host":
      return { name: "host", host: target.hostId };
    case "projects":
      return { name: "projects", host: target.hostId };
    case "settings":
      return { name: "settings" };
    case "costs":
      return { name: "costs" };
    case "connect-ssh":
      return { name: "connections", connect: target.targetId };
  }
}

/**
 * The tab shortcuts (Ctrl+T/W/Shift+T, Ctrl+Tab, Ctrl+1…9, Ctrl+Shift+PageUp/Down): true when the
 * key was one of them and has been handled.
 */
function tabShortcut(store: AppStore, e: KeyboardEvent): boolean {
  const { tabs } = store;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (key === "\\") store.workspace.toggleSplit();
  else if (key === "t" && e.shiftKey) tabs.reopen();
  else if (key === "t") {
    tabs.open({ name: "home" });
    store.openSearch();
  } else if (key === "w") store.closeTab(tabs, tabs.activeId);
  else if (key === "Tab") {
    if (e.shiftKey) tabs.previous();
    else tabs.next();
  } else if (/^[1-9]$/.test(key) && !e.shiftKey) tabs.goto(Number(key));
  else if ((key === "PageUp" || key === "PageDown") && e.shiftKey) {
    const index = tabs.tabs.findIndex((tab) => tab.id === tabs.activeId);
    tabs.move(tabs.activeId, index + (key === "PageUp" ? -1 : 1));
  } else return false;
  return true;
}

export function App({ store }: { store: AppStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const themeMode = useSyncExternalStore(store.theme.subscribe, () => store.theme.mode);
  const lang = useSyncExternalStore(store.i18n.subscribe, () => store.i18n.lang);
  const density = useSyncExternalStore(store.density.subscribe, () => store.density.value);
  const { router } = store;
  const route = useSyncExternalStore(router.subscribe, () => router.current);
  const { t } = store.i18n;

  // The header's path names the project of a board, a card or workflows: load the host's projects
  // when the screen was opened without passing through them (a link, a card of the queue).
  const projectHost =
    route.name === "board" ||
    route.name === "card" ||
    route.name === "workflows" ||
    route.name === "automations"
      ? route.host
      : null;
  const projectsKnown = projectHost === null || state.projects[projectHost] !== undefined;
  const projectHostOnline = state.hosts.some((h) => h.id === projectHost && h.status === "online");
  useEffect(() => {
    if (projectHost && !projectsKnown && projectHostOnline) void store.loadProjects(projectHost);
  }, [store, projectHost, projectsKnown, projectHostOnline]);

  /** Opening anything closes the layers above it: the palette (dialogs go with their screen). */
  const go = (next: Route) => {
    store.closeSearch();
    router.push(next);
  };

  useEffect(() => {
    void store.init();
    return () => store.dispose();
  }, [store]);

  // Links come from anywhere: a pairing link only prefills the form (saving needs the user's
  // click); a request link (a notification click) shows the request.
  useEffect(
    () =>
      store.onDeepLink((url) => {
        if (store.openRequestLink(url)) return;
        const parsed = parsePairingLink(url);
        if (!parsed.ok) {
          store.reportError(`Link de pareamento recusado: ${parsed.error}`);
          return;
        }
        const { url: wsUrl, name, token } = parsed.value;
        store.closeSearch();
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
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        store.openSearch();
      } else if ((e.ctrlKey || e.metaKey) && tabShortcut(store, e)) {
        e.preventDefault();
      } else if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        if (e.key === "ArrowLeft") router.back();
        else router.forward();
      }
    };
    // Ctrl+click and the middle button open what was clicked in a new tab: the navigation of
    // that event goes to a new tab (the middle button fires no click, so it clicks for itself).
    const onNewTab = (e: MouseEvent) => {
      const middle = e.type === "auxclick";
      if (middle ? e.button !== 1 : !(e.ctrlKey || e.metaKey)) return;
      store.tabs.openNextInNewTab();
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
      const only = list?.projects.length === 1 ? list.projects[0] : undefined;
      if (only) {
        go(
          kind === "board"
            ? { name: "board", host: hostId, projectId: only.id }
            : { name: "workflows", host: hostId, projectId: only.id, projectName: only.name },
        );
      } else go({ name: "projects", host: hostId, focus: kind });
    });
  };

  /** An entry or action of the Ctrl+K palette: its screen, or an action in place. */
  const goTo = (target: PaletteTarget) => {
    store.closeSearch();
    if (target.kind === "terminal") {
      if (store.embeddedTerminal(target.hostId))
        void store.openClaudeHere(target.hostId, target.target);
      else void store.openInTerminal(target.hostId, target.target);
    } else if (target.kind === "new-terminal") void store.openTerminal(target.hostId);
    else if (target.kind === "toggle-theme") store.theme.toggle();
    else if (target.kind === "switch-language") {
      store.i18n.setLang(lang === "pt-BR" ? "en" : "pt-BR");
    } else if (target.kind === "start-card") {
      void store.hostCommand(target.hostId, "card.start", { cardId: target.cardId });
    } else go(paletteRoute(target));
  };

  return (
    <TContext.Provider value={t}>
      <TooltipProvider>
        <AppShell
          labels={{
            sidebar: t("shell.sidebar"),
            collapse: t("shell.collapse"),
            expand: t("shell.expand"),
          }}
          header={
            <>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("nav.back")}
                disabled={!router.canBack}
                onClick={() => router.back()}
              >
                <ArrowLeft />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("nav.forward")}
                disabled={!router.canForward}
                onClick={() => router.forward()}
              >
                <ArrowRight />
              </Button>
              <Breadcrumb
                crumbs={breadcrumb(route, state, t)}
                label={t("shell.breadcrumb")}
                onGo={go}
              />
            </>
          }
          sidebar={(collapsed) => (
            <Sidebar
              state={state}
              collapsed={collapsed}
              t={t}
              go={go}
              onOpenProjectScreen={openProjectScreen}
              onNewSession={(hostId) => {
                store.select(hostId, null);
                go({ name: "new-session", host: hostId });
              }}
              onRemoveHost={(id) => void store.removeHost(id)}
              onOpenSearch={() => store.openSearch()}
              onNewTab={() => store.tabs.openNextInNewTab()}
              onToggleTheme={() => store.theme.toggle()}
            />
          )}
        >
          <div className="flex h-full min-h-0 flex-col">
            <UpdateBanner store={store} state={state} />
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
          <Notices store={store} state={state} />
          {state.closingTerminal && (
            <TerminalCloseDialog onClose={(kill) => void store.finishCloseTerminal(kill)} />
          )}
          <AskpassPrompt store={store} state={state} />
          {state.searchOpen && (
            <GlobalSearch
              state={state}
              store={store}
              costs={true}
              onGo={goTo}
              onSearch={(query) => void store.searchHistory(query)}
              onClose={() => store.closeSearch()}
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
