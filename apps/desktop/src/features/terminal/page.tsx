import { Suspense, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SnippetPicker } from "@/features/snippets/ui.ts";
import { IconTip } from "@/shared/feedback/index.ts";
import { Page } from "@/shared/layout/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import { useStoreState } from "../../lib/use-store.ts";
import { LazyFileViewer } from "../files/ui.ts";
import {
  type FindFlags,
  findPatternProblem,
  isWindowsHost,
  TERMINAL_FONT_FAMILY,
  terminalTheme,
} from "./domain/terminal-view.ts";
import { MENU_ITEM, moveInMenu } from "./menu-keys.ts";
import { askPaste, openPath, type Pasting, type Viewing } from "./terminal-actions.ts";
import { TerminalCloseDialog, TerminalPasteDialog } from "./terminal-dialogs.tsx";
import { TerminalSession, type TerminalState } from "./terminal-session.ts";
import {
  createXtermScreen,
  type FindResults,
  type XtermDeps,
  type XtermScreen,
} from "./xterm-screen.ts";

/** A host's terminal in the app: xterm over a `TerminalSession`, with search and close. */
export function TerminalPage(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    terminalId: string;
    /** xterm's pieces; the real ones when absent. */
    deps?: XtermDeps;
    /** The terminal was closed from here (detached or ended): leave the screen. */
    onClosed(): void;
  }>,
) {
  const { store, hostId, terminalId } = props;
  const { t } = store.i18n;
  const area = useRef<HTMLDivElement>(null);
  const session = useRef<TerminalSession | null>(null);
  const screen = useRef<XtermScreen | null>(null);
  const [state, setState] = useState<{ state: TerminalState; exitCode: number | null }>({
    state: "attaching",
    exitCode: null,
  });
  const [searching, setSearching] = useState(false);
  /** A file of the terminal's folder open in the Files viewer, from a clicked `path:line` (#506). */
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const [needle, setNeedle] = useState("");
  /** Match case, whole word, regular expression (#476); the ref has the latest for a key and a change in one go. */
  const [flags, setFlags] = useState<FindFlags>({});
  const flagsNow = useRef<FindFlags>({});
  const find = (text: string, direction: "next" | "previous", incremental = false) =>
    screen.current?.find(text, direction, incremental, flagsNow.current);
  const flip = (flag: keyof FindFlags) => {
    flagsNow.current = { ...flagsNow.current, [flag]: !flagsNow.current[flag] };
    setFlags(flagsNow.current);
    if (needle !== "") find(needle, "next", true);
  };
  const problem = needle === "" ? null : findPatternProblem(needle, flags);
  const [closing, setClosing] = useState(false);
  /** A paste of several lines waiting for the OK: how many lines, and the answer to give xterm. */
  const [pasting, setPasting] = useState<Pasting | null>(null);
  /** Where the right button opened the copy and paste menu. */
  const [menu, setMenu] = useState<{ x: number; y: number; canCopy: boolean } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  /** Where the current match sits among all of them, as xterm reports it. */
  const [results, setResults] = useState<FindResults | null>(null);
  const [picking, setPicking] = useState(false);
  const [launchId, setLaunchId] = useState<string | null>(null);
  const appState = useStoreState(store);
  /** The session in the central of a "Claude aqui" terminal: same host, same launch. */
  const linked = Object.entries(appState.externals).find(
    ([key, external]) =>
      launchId !== null && key.startsWith(`${hostId}/`) && external.launchId === launchId,
  )?.[1];
  const font = useSyncExternalStore(store.terminalFont.subscribe, () => store.terminalFont.value);
  const reader = useSyncExternalStore(
    store.terminalReader.subscribe,
    () => store.terminalReader.value,
  );
  const readerHint = useId();
  const theme = useSyncExternalStore(store.theme.subscribe, () => store.theme.resolved);

  useEffect(() => {
    let alive = true;
    /** What the cleanup undoes, once the async start got that far. */
    const stops: Array<() => void> = [];
    const parent = area.current;
    void (async () => {
      const deps = props.deps ?? (await import("./xterm-deps.ts")).realXtermDeps;
      if (!alive || !parent) return;
      const host = store.terminals.host(hostId);
      // The terminal's folder, for the relative paths of its output: known once the list answers.
      let folder: Promise<string | null> = Promise.resolve(null);
      const xterm = createXtermScreen(deps, {
        theme: terminalTheme(store.theme.resolved),
        fontSize: store.terminalFont.value,
        screenReader: store.terminalReader.value,
        fontFamily: TERMINAL_FONT_FAMILY,
        windows: isWindowsHost(navigator.userAgent),
        clipboard: {
          copy: async (text) => {
            await store.system.copyText(text);
          },
          read: () => navigator.clipboard.readText(),
        },
        onInput: (data) => session.current?.input(data),
        onResize: (cols, rows) => session.current?.resize(cols, rows),
        onSearch: () => setSearching(true),
        onFindResults: setResults,
        onLink: (uri) => store.openLink(uri),
        onSnippets: () => setPicking(true),
        onPath: (path, at) => void openPath(store, hostId, folder, path, at, setViewing),
        confirmPaste: (text) => askPaste(text, setPasting, () => xterm.focus()),
        onZoom: (step) => store.terminalFont.zoom(step),
      });
      const current = new TerminalSession({
        terminalId,
        host,
        screen: xterm,
        onState: (next, exitCode) => setState({ state: next, exitCode }),
      });
      screen.current = xterm;
      session.current = current;
      xterm.open(parent);
      // A resized window, tab or split changes the box: xterm fits it again, and its new size goes
      // to the host through the session's debounced resize.
      const observer = new ResizeObserver(() => xterm.fit());
      observer.observe(parent);
      stops.push(
        () => observer.disconnect(),
        store.terminals.follow(hostId, terminalId, {
          data: (base64) => current.data(base64),
          exited: (code) => current.exited(code),
          resync: () => void current.reopen(),
          offline: () => current.disconnected(),
        }),
      );
      await current.start();
      // A "Claude aqui" terminal carries the launch its session in the central also carries.
      const listed = host.list().catch(() => []);
      folder = listed.then((list) => list.find((t) => t.terminalId === terminalId)?.cwd ?? null);
      const info = (await listed).find((t) => t.terminalId === terminalId);
      if (alive) setLaunchId(info?.launchId ?? null);
    })();
    return () => {
      alive = false;
      for (const stop of stops) stop();
      session.current?.dispose();
      screen.current?.dispose();
      session.current = null;
      screen.current = null;
    };
  }, [store, hostId, terminalId, props.deps]);

  // A click anywhere else closes the menu. The terminal gets the focus back unless the click put
  // it on another control (#2608).
  useEffect(() => {
    if (!menu) return;
    const close = () => {
      setMenu(null);
      const held = document.activeElement;
      if (!held || held === document.body || menuRef.current?.contains(held)) {
        screen.current?.focus();
      }
    };
    window.addEventListener("click", close);
    // Esc closes the menu wherever the focus is. It is the menu's key: it goes no further (capture
    // phase), so it does not close the detail (#2591) or reach the shell as an ESC.
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setMenu(null);
      screen.current?.focus();
    };
    document.addEventListener("keydown", onEsc, true);
    return () => {
      window.removeEventListener("click", close);
      document.removeEventListener("keydown", onEsc, true);
    };
  }, [menu]);
  // The menu takes the focus, on the first thing it can do.
  useEffect(() => {
    if (menu) menuRef.current?.querySelector<HTMLElement>(MENU_ITEM)?.focus();
  }, [menu]);
  const fromMenu = (action: "copy" | "paste" | "selectAll") => {
    setMenu(null);
    screen.current?.[action]();
    screen.current?.focus();
  };

  useEffect(() => screen.current?.setFontSize(font), [font]);
  useEffect(() => screen.current?.setScreenReader(reader), [reader]);
  useEffect(() => screen.current?.setTheme(terminalTheme(theme)), [theme]);

  const close = async (kill: boolean) => {
    setClosing(false);
    await session.current?.close(kill);
    props.onClosed();
  };
  const stopSearch = () => {
    setSearching(false);
    setResults(null);
    screen.current?.clearFind();
    screen.current?.focus();
  };
  const findStatus = (found: FindResults) =>
    found.resultCount > 0
      ? t("terminalUi.matches", {
          index: String(Math.max(found.resultIndex, 0) + 1),
          count: String(found.resultCount),
        })
      : t("terminalUi.noMatches");
  const status =
    state.state === "ended"
      ? t("terminalUi.state.ended", { code: String(state.exitCode) })
      : t(`terminalUi.state.${state.state}`);

  return (
    <Page
      fill
      title={t("terminalUi.title")}
      subtitle={<output>{status}</output>}
      actions={
        <>
          {(state.state === "detached" || state.state === "ended") && (
            <Button size="sm" onClick={() => void session.current?.reopen()}>
              {t("terminalUi.reopen")}
            </Button>
          )}
          {linked && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                store.hostTabs.show({
                  name: "external",
                  host: hostId,
                  claudeSessionId: linked.claudeSessionId,
                })
              }
            >
              {t("claudeHere.asSession")}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setClosing(true)}>
            {t("terminalUi.close")}
          </Button>
        </>
      }
      toolbar={
        searching && (
          <div className="terminal-find">
            <Input
              type="search"
              autoFocus
              aria-label={t("terminalUi.searchLabel")}
              title={t("terminalUi.searchHint")}
              value={needle}
              onChange={(e) => {
                setNeedle(e.target.value);
                if (e.target.value === "") {
                  setResults(null);
                  screen.current?.clearFind();
                } else find(e.target.value, "next", true);
              }}
              onKeyDown={(e) => {
                const flag = e.altKey && !e.ctrlKey ? FIND_KEYS[e.key.toLowerCase()] : undefined;
                if (flag) {
                  e.preventDefault();
                  flip(flag);
                } else if (e.key === "Escape") {
                  // Handled here: left unmarked, the key closes the detail too (#2591).
                  e.preventDefault();
                  stopSearch();
                } else if (e.key === "Enter") find(needle, e.shiftKey ? "previous" : "next");
              }}
            />
            {FIND_TOGGLES.map(([flag, label, glyph, keys]) => (
              <IconTip key={flag} label={`${t(label)} (${keys})`}>
                <Button
                  size="sm"
                  variant="ghost"
                  className="terminal-find-toggle"
                  aria-label={t(label)}
                  aria-keyshortcuts={keys}
                  aria-pressed={flags[flag] === true}
                  onClick={() => flip(flag)}
                >
                  <span aria-hidden="true">{glyph}</span>
                </Button>
              </IconTip>
            ))}
            <output className="text-xs text-muted-foreground">
              {problem
                ? t(PATTERN_PROBLEM[problem])
                : needle !== "" && results && findStatus(results)}
            </output>
            <Button size="sm" variant="ghost" onClick={() => find(needle, "previous")}>
              {t("terminalUi.findPrevious")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => find(needle, "next")}>
              {t("terminalUi.findNext")}
            </Button>
            <Button size="sm" variant="ghost" onClick={stopSearch}>
              {t("terminalUi.findClose")}
            </Button>
          </div>
        )
      }
    >
      <div
        ref={area}
        data-terminal-area
        role="application"
        aria-label={t("terminalUi.title")}
        // While xterm keeps no copy for screen readers, the terminal says where to turn it on (#476).
        aria-describedby={reader ? undefined : readerHint}
        className="min-h-80 w-full flex-1"
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({
            x: e.clientX,
            y: e.clientY,
            canCopy: screen.current?.hasSelection() ?? false,
          });
        }}
      />
      {!reader && (
        <p id={readerHint} hidden>
          {t("terminalUi.readerHint")}
        </p>
      )}
      {viewing && (
        <div data-slot="terminal-file" className="terminal-file">
          <Suspense fallback={null}>
            <LazyFileViewer
              store={store}
              hostId={hostId}
              target={`terminal:${terminalId}`}
              path={viewing.path}
              full={viewing.full}
              line={viewing.line}
              col={viewing.col}
              onClose={() => setViewing(null)}
            />
          </Suspense>
        </div>
      )}
      {menu && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t("terminalUi.title")}
          tabIndex={-1}
          className="fixed z-50 flex flex-col rounded-md border bg-popover p-1 text-sm shadow-md"
          style={{ left: menu.x, top: menu.y }}
          onKeyDown={(e) => moveInMenu(e, menuRef.current)}
        >
          <Button
            role="menuitem"
            variant="ghost"
            size="sm"
            className="justify-start"
            disabled={!menu.canCopy}
            onClick={() => fromMenu("copy")}
          >
            {t("terminalUi.copy")}
          </Button>
          <Button
            role="menuitem"
            variant="ghost"
            size="sm"
            className="justify-start"
            onClick={() => fromMenu("paste")}
          >
            {t("terminalUi.paste")}
          </Button>
          <Button
            role="menuitem"
            variant="ghost"
            size="sm"
            className="justify-start"
            onClick={() => fromMenu("selectAll")}
          >
            {t("terminalUi.selectAll")}
          </Button>
        </div>
      )}
      {pasting && <TerminalPasteDialog lines={pasting.lines} onAnswer={pasting.answer} />}
      {closing && (
        <TerminalCloseDialog
          onClose={(kill) => (kill === null ? setClosing(false) : void close(kill))}
        />
      )}
      {picking && (
        <SnippetPicker
          store={store}
          hostId={hostId}
          onPick={(choice) => {
            setPicking(false);
            store.snippets.choose(choice);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </Page>
  );
}

/** Closing a terminal: detach (the default; the process keeps running on the host) or end it. */
/** Alt and a letter turn a find option on or off while the search box has the focus, as in VS Code. */
const FIND_KEYS: Record<string, keyof FindFlags> = {
  c: "caseSensitive",
  w: "wholeWord",
  r: "regex",
};

/** The find options' buttons: the option, its name, the glyph drawn for it and its key. */
const FIND_TOGGLES = [
  ["caseSensitive", "terminalUi.matchCase", "Aa", "Alt+C"],
  ["wholeWord", "terminalUi.wholeWord", "ab", "Alt+W"],
  ["regex", "terminalUi.useRegex", ".*", "Alt+R"],
] as const;

/** What the search box says about a pattern that cannot be searched. */
const PATTERN_PROBLEM = {
  invalid: "terminalUi.badPattern",
  empty: "terminalUi.emptyPattern",
} as const;
