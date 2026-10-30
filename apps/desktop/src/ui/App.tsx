import { parsePairingLink } from "@flightdeck/protocol";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { Notices } from "@/components/feedback/notices";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { AppStore, PendingItem } from "../lib/app-store.ts";
import type { PaletteTarget } from "../lib/palette.ts";
import type { Route } from "../lib/router.ts";
import { GlobalSearch } from "./GlobalSearch.tsx";
import { draftFromLink } from "./HostForm.tsx";
import { Screen } from "./Screens.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { UpdateBanner } from "./UpdateBanner.tsx";

/** The palette's targets that act in place instead of opening a screen. */
type InPlace = "terminal" | "toggle-theme" | "switch-language" | "start-card";

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
  }
}

export function App({ store }: { store: AppStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const themeMode = useSyncExternalStore(store.theme.subscribe, () => store.theme.mode);
  const lang = useSyncExternalStore(store.i18n.subscribe, () => store.i18n.lang);
  const density = useSyncExternalStore(store.density.subscribe, () => store.density.value);
  const { router } = store;
  const route = useSyncExternalStore(router.subscribe, () => router.current);
  const { t } = store.i18n;

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
      } else if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        if (e.key === "ArrowLeft") router.back();
        else router.forward();
      }
    };
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) router.back();
      if (e.button === 4) router.forward();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mouseup", onMouse);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mouseup", onMouse);
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
    if (target.kind === "terminal") void store.openInTerminal(target.hostId, target.target);
    else if (target.kind === "toggle-theme") store.theme.toggle();
    else if (target.kind === "switch-language") {
      store.i18n.setLang(lang === "pt-BR" ? "en" : "pt-BR");
    } else if (target.kind === "start-card") {
      void store.hostCommand(target.hostId, "card.start", { cardId: target.cardId });
    } else go(paletteRoute(target));
  };

  return (
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
          </>
        }
        sidebar={(collapsed) => (
          <Sidebar
            state={state}
            collapsed={collapsed}
            t={t}
            go={go}
            onOpenProjectScreen={openProjectScreen}
            onSelectSession={(hostId, id) => {
              store.select(hostId, id);
              go(
                id ? { name: "session", host: hostId, id } : { name: "new-session", host: hostId },
              );
            }}
            onRemoveHost={(id) => void store.removeHost(id)}
            onOpenSearch={() => store.openSearch()}
            onToggleTheme={() => store.theme.toggle()}
          />
        )}
      >
        <div className="flex h-full min-h-0 flex-col">
          <UpdateBanner store={store} state={state} />
          {/* Screens that are a Page scroll by themselves; the others scroll here. */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Screen
              route={route}
              store={store}
              state={state}
              theme={themeMode}
              density={density}
              go={go}
              onOpenRequest={openRequest}
            />
          </div>
        </div>
        <Notices store={store} state={state} />
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
  );
}
