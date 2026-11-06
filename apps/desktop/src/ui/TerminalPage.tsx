import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { IconTip } from "@/components/feedback/icon-tip";
import { Page } from "@/components/layout/page";
import { SnippetPicker } from "@/components/snippets/snippet-picker";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";
import type { AppStore } from "../lib/app-store.ts";
import { resolvePath } from "../lib/terminal-paths.ts";
import { TerminalSession, type TerminalState } from "../lib/terminal-session.ts";
import {
  type FindFlags,
  findPatternProblem,
  isWindowsHost,
  pasteLines,
  TERMINAL_FONT_FAMILY,
  terminalTheme,
} from "../lib/terminal-view.ts";
import { useStoreState } from "../lib/use-store.ts";
import {
  createXtermScreen,
  type FindResults,
  type XtermDeps,
  type XtermScreen,
} from "../lib/xterm-screen.ts";

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
  const [pasting, setPasting] = useState<{ lines: number; answer(ok: boolean): void } | null>(null);
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
      const deps = props.deps ?? (await import("../lib/xterm-deps.ts")).realXtermDeps;
      if (!alive || !parent) return;
      const host = store.terminalHost(hostId);
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
            await store.copyText(text);
          },
          read: () => navigator.clipboard.readText(),
        },
        onInput: (data) => session.current?.input(data),
        onResize: (cols, rows) => session.current?.resize(cols, rows),
        onSearch: () => setSearching(true),
        onFindResults: setResults,
        onLink: (uri) => store.openLink(uri),
        onSnippets: () => setPicking(true),
        onPath: (path) => void showPath(store, hostId, path, folder),
        confirmPaste: (text) =>
          new Promise<boolean>((resolve) =>
            setPasting({
              lines: pasteLines(text),
              answer: (ok) => {
                setPasting(null);
                resolve(ok);
                xterm.focus();
              },
            }),
          ),
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
      stops.push(() => observer.disconnect());
      stops.push(
        store.followTerminal(hostId, terminalId, {
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

  // A click anywhere else closes the menu.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);
  // The menu takes the focus, on the first thing it can do.
  useEffect(() => {
    if (menu) menuRef.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
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
      subtitle={<span role="status">{status}</span>}
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
                store.tabs.open({
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
                } else if (e.key === "Escape") stopSearch();
                else if (e.key === "Enter") find(needle, e.shiftKey ? "previous" : "next");
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
            <span role="status" className="text-xs text-muted-foreground">
              {problem
                ? t(problem === "invalid" ? "terminalUi.badPattern" : "terminalUi.emptyPattern")
                : needle !== "" && results && findStatus(results)}
            </span>
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
      {menu && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t("terminalUi.title")}
          tabIndex={-1}
          className="fixed z-50 flex flex-col rounded-md border bg-popover p-1 text-sm shadow-md"
          style={{ left: menu.x, top: menu.y }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setMenu(null);
          }}
        >
          <Button
            variant="ghost"
            size="sm"
            className="justify-start"
            disabled={!menu.canCopy}
            onClick={() => fromMenu("copy")}
          >
            {t("terminalUi.copy")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="justify-start"
            onClick={() => fromMenu("paste")}
          >
            {t("terminalUi.paste")}
          </Button>
          <Button
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
            store.chooseSnippet(choice);
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

/**
 * A path clicked in a terminal's output (#476): on a host of this computer the file is shown in its
 * folder, never opened or run (the app's own checks refuse links, `..` and shares); on another
 * host the path is copied. A relative path is taken from the terminal's folder.
 */
async function showPath(
  store: AppStore,
  hostId: string,
  path: string,
  folder: Promise<string | null>,
): Promise<void> {
  const cwd = await folder;
  const full = cwd ? resolvePath(cwd, path) : path;
  if (store.canOpenPaths(hostId)) await store.revealPath(hostId, full);
  else await store.copyText(full);
}

/**
 * The OK before a paste of several lines (#476): the program has not turned on bracketed paste, so
 * each line may run as a command as soon as it lands. Cancel has the focus: it is the safe answer.
 */
export function TerminalPasteDialog(
  props: Readonly<{ lines: number; onAnswer(ok: boolean): void }>,
) {
  const t = useT();
  return (
    <AlertDialog open onOpenChange={(open) => !open && props.onAnswer(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("terminalUi.pasteTitle", { n: String(props.lines) })}
          </AlertDialogTitle>
          <AlertDialogDescription>{t("terminalUi.pasteMessage")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={() => props.onAnswer(true)}>
            {t("terminalUi.pasteConfirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function TerminalCloseDialog(props: Readonly<{ onClose(kill: boolean | null): void }>) {
  const t = useT();
  const detach = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog open onOpenChange={(open) => !open && props.onClose(null)}>
      <AlertDialogContent
        onOpenAutoFocus={(event) => {
          // Radix focuses Cancel; the safe answer here is Detach, never End.
          event.preventDefault();
          detach.current?.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{t("terminalUi.close")}</AlertDialogTitle>
          <AlertDialogDescription>{t("terminalUi.closeMessage")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => props.onClose(true)}>
            {t("terminalUi.end")}
          </AlertDialogAction>
          <AlertDialogAction ref={detach} onClick={() => props.onClose(false)}>
            {t("terminalUi.detach")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
