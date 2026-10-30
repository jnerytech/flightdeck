import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Page } from "@/components/layout/page";
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
import { TerminalSession, type TerminalState } from "../lib/terminal-session.ts";
import { TERMINAL_FONT_FAMILY, terminalTheme } from "../lib/terminal-view.ts";
import { createXtermScreen, type XtermDeps, type XtermScreen } from "../lib/xterm-screen.ts";

/** A host's terminal in the app: xterm over a `TerminalSession`, with search and close. */
export function TerminalPage(props: {
  store: AppStore;
  hostId: string;
  terminalId: string;
  /** xterm's pieces; the real ones when absent. */
  deps?: XtermDeps;
  /** The terminal was closed from here (detached or ended): leave the screen. */
  onClosed(): void;
}) {
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
  const [closing, setClosing] = useState(false);
  const [launchId, setLaunchId] = useState<string | null>(null);
  const appState = useSyncExternalStore(store.subscribe, store.getState);
  /** The session in the central of a "Claude aqui" terminal: same host, same launch. */
  const linked = Object.entries(appState.externals).find(
    ([key, external]) =>
      launchId !== null && key.startsWith(`${hostId}/`) && external.launchId === launchId,
  )?.[1];
  const font = useSyncExternalStore(store.terminalFont.subscribe, () => store.terminalFont.value);
  const theme = useSyncExternalStore(store.theme.subscribe, () => store.theme.resolved);

  useEffect(() => {
    let alive = true;
    let stopFollowing = () => {};
    let stopObserving = () => {};
    const parent = area.current;
    void (async () => {
      const deps = props.deps ?? (await import("../lib/xterm-deps.ts")).realXtermDeps;
      if (!alive || !parent) return;
      const host = store.terminalHost(hostId);
      const xterm = createXtermScreen(deps, {
        theme: terminalTheme(store.theme.resolved),
        fontSize: store.terminalFont.value,
        fontFamily: TERMINAL_FONT_FAMILY,
        clipboard: {
          copy: async (text) => void (await store.copyText(text)),
          read: () => navigator.clipboard.readText(),
        },
        onInput: (data) => session.current?.input(data),
        onResize: (cols, rows) => session.current?.resize(cols, rows),
        onSearch: () => setSearching(true),
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
      stopObserving = () => observer.disconnect();
      stopFollowing = store.followTerminal(hostId, terminalId, {
        data: (base64) => current.data(base64),
        exited: (code) => current.exited(code),
        resync: () => void current.reopen(),
        offline: () => current.disconnected(),
      });
      await current.start();
      // A "Claude aqui" terminal carries the launch its session in the central also carries.
      const info = (await host.list().catch(() => [])).find((t) => t.terminalId === terminalId);
      if (alive) setLaunchId(info?.launchId ?? null);
    })();
    return () => {
      alive = false;
      stopFollowing();
      stopObserving();
      session.current?.dispose();
      screen.current?.dispose();
      session.current = null;
      screen.current = null;
    };
  }, [store, hostId, terminalId, props.deps]);

  useEffect(() => screen.current?.setFontSize(font), [font]);
  useEffect(() => screen.current?.setTheme(terminalTheme(theme)), [theme]);

  const close = async (kill: boolean) => {
    setClosing(false);
    await session.current?.close(kill);
    props.onClosed();
  };
  const stopSearch = () => {
    setSearching(false);
    screen.current?.clearFind();
    screen.current?.focus();
  };
  const status =
    state.state === "ended"
      ? t("terminalUi.state.ended", { code: String(state.exitCode) })
      : t(`terminalUi.state.${state.state}`);

  return (
    <Page
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
          <Input
            type="search"
            autoFocus
            aria-label={t("terminalUi.searchLabel")}
            title={t("terminalUi.searchHint")}
            value={needle}
            onChange={(e) => setNeedle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") stopSearch();
              else if (e.key === "Enter") {
                screen.current?.find(needle, e.shiftKey ? "previous" : "next");
              }
            }}
          />
        )
      }
    >
      <div ref={area} className="h-[60vh] w-full" />
      {closing && (
        <TerminalCloseDialog
          onClose={(kill) => (kill === null ? setClosing(false) : void close(kill))}
        />
      )}
    </Page>
  );
}

/** Closing a terminal: detach (the default; the process keeps running on the host) or end it. */
export function TerminalCloseDialog(props: { onClose(kill: boolean | null): void }) {
  const t = useT();
  return (
    <AlertDialog open onOpenChange={(open) => !open && props.onClose(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("terminalUi.close")}</AlertDialogTitle>
          <AlertDialogDescription>{t("terminalUi.closeMessage")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => props.onClose(true)}>
            {t("terminalUi.end")}
          </AlertDialogAction>
          <AlertDialogAction onClick={() => props.onClose(false)}>
            {t("terminalUi.detach")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
