import { useEffect, useRef } from "react";
import { type ChordState, chordStep, NO_CHORD, typing } from "../features/shortcuts/index.ts";
import { tabIntent } from "../features/tabs/index.ts";
import type { AppStore } from "../lib/app-store.ts";
import type { Route } from "../lib/router.ts";

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
    if (store.uiModes.toggle()) e.preventDefault();
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

/**
 * The window's keyboard and mouse: Ctrl+K, the tab shortcuts, the go-to chords and `?` (`showHelp`
 * opens the sheet), Alt+←/→, the mouse's back and forward buttons, and a click that opens in a new tab.
 * `showHelp` must keep its identity between renders, or the listeners are added again each time.
 */
export function useWindowKeys(store: AppStore, showHelp: () => void): void {
  const { router } = store;
  const chord = useRef<ChordState>(NO_CHORD);
  // Ctrl+K inside the app only (as a global shortcut it would clash with browsers and VS Code);
  // Alt+←/→ and the mouse's back and forward buttons walk the history.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => appKey(e, store, chord, showHelp);
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
  }, [store, router, showHelp]);
}
