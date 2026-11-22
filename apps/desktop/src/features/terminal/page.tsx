import {
  Suspense,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Button } from "@/components/ui/button";
import { RequestError } from "@/features/hosts/index.ts";
import { SnippetPicker } from "@/features/snippets/ui.ts";
import { refusalText } from "@/i18n/errors.ts";
import type { T } from "@/i18n/index.ts";
import { ActionButton, InlineNotice } from "@/shared/feedback/index.ts";
import { Page, Stack } from "@/shared/layout/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import { useStoreState } from "../../lib/use-store.ts";
import { LazyFileViewer } from "../files/ui.ts";
import { clampMenu } from "./domain/menu-placement.ts";
import {
  type FindFlags,
  isWindowsHost,
  TERMINAL_FONT_FAMILY,
  terminalTheme,
} from "./domain/terminal-view.ts";
import { MENU_ITEM, moveInMenu } from "./menu-keys.ts";
import { askPaste, openPath, type Pasting, type Viewing } from "./terminal-actions.ts";
import { TerminalCloseDialog, TerminalPasteDialog } from "./terminal-dialogs.tsx";
import { TerminalFind } from "./terminal-find.tsx";
import { TerminalSession, type TerminalState } from "./terminal-session.ts";
import {
  createXtermScreen,
  type FindResults,
  type XtermDeps,
  type XtermScreen,
} from "./xterm-screen.ts";

const plainReason = (error: unknown) => (error instanceof Error ? error.message : String(error));
/** What a person reads of a failure: the host's refusal in their language, or the message of any other. */
const reasonText = (error: unknown, t: T) =>
  error instanceof RequestError
    ? refusalText(error.code, error.message, t, error)
    : plainReason(error);

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
        onState: (next, exitCode) => {
          setState({ state: next, exitCode });
          // A refused write is about the live terminal it was typed into: not one that was left or attached again.
          if (next !== "live") setWriteFailed(null);
        },
        onFailure: (kind, error) => {
          const failure = error === null ? null : { error };
          if (kind === "attach") setAttachFailed(failure);
          else setWriteFailed(failure);
        },
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
  // The menu opens at the click point; once it has its size it moves back inside the window (#3953).
  // The clamped point is a fixed point of clampMenu, so this settles after one more render.
  useLayoutEffect(() => {
    const box = menuRef.current?.getBoundingClientRect();
    if (!menu || !box) return;
    const at = clampMenu(menu, box, { width: window.innerWidth, height: window.innerHeight });
    if (at.x !== menu.x || at.y !== menu.y) setMenu({ ...menu, ...at });
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

  /** Why the host did not close the terminal: the person stays, and Close can be pressed again (#3949). */
  const [closeFailed, setCloseFailed] = useState<string | null>(null);
  /** What the host refused the last attach or write with (#3950); `null` once the next one is accepted. */
  const [attachFailed, setAttachFailed] = useState<{ error: unknown } | null>(null);
  const [writeFailed, setWriteFailed] = useState<{ error: unknown } | null>(null);
  const close = async (kill: boolean) => {
    setClosing(false);
    setCloseFailed(null);
    const refused = await session.current?.close(kill);
    // A terminal the host no longer has is already closed: there is nothing left to keep the person for.
    if (refused === null || (refused instanceof RequestError && refused.code === "not_found")) {
      return props.onClosed();
    }
    setCloseFailed(reasonText(refused, t));
  };
  const stopSearch = () => {
    setSearching(false);
    setResults(null);
    screen.current?.clearFind();
    screen.current?.focus();
  };
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
          {state.state !== "live" && (
            <ActionButton
              size="sm"
              pending={state.state === "attaching"}
              onClick={() => session.current?.reopen()}
            >
              {t("terminalUi.reopen")}
            </ActionButton>
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
          <TerminalFind
            t={t}
            needle={needle}
            flags={flags}
            results={results}
            onChange={(text) => {
              setNeedle(text);
              if (text === "") {
                setResults(null);
                screen.current?.clearFind();
              } else find(text, "next", true);
            }}
            onFlip={flip}
            onFind={(direction) => find(needle, direction)}
            onClose={stopSearch}
          />
        )
      }
    >
      {/* One block for the notices, so they have air between them and the terminal, and none when there is none. */}
      <Stack gap={2} className="empty:hidden">
        {(state.state === "detached" || state.state === "ended") && !attachFailed && (
          <InlineNotice tone="info">{t(`terminalUi.notLive.${state.state}`)}</InlineNotice>
        )}
        {attachFailed && (
          <InlineNotice tone="error">
            {t("terminalUi.attachFailed", { reason: reasonText(attachFailed.error, t) })}
          </InlineNotice>
        )}
        {writeFailed && (
          <InlineNotice tone="error">
            {t("terminalUi.writeFailed", { reason: reasonText(writeFailed.error, t) })}
          </InlineNotice>
        )}
        {closeFailed && (
          <InlineNotice tone="error">
            {t("terminalUi.closeFailed", { reason: closeFailed })}
          </InlineNotice>
        )}
      </Stack>
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
