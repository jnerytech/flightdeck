import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import type { AppStore } from "../lib/app-store.ts";
import { SESSION_VIEWS, type SessionView, VIEW_LABEL } from "../lib/session-views.ts";
import { useLaunchTerminal } from "../lib/use-launch-terminal.ts";
import type { XtermDeps } from "../lib/xterm-screen.ts";
import { ChangesPanel } from "./ChangesPanel.tsx";
import { FileExplorer } from "./FileExplorer.tsx";
import { SessionFiles } from "./SessionFiles.tsx";
import { SessionMessages } from "./SessionMessages.tsx";
import { SessionTerminal } from "./SessionTerminal.tsx";
import { TempoPanel } from "./TempoPanel.tsx";
import { TracePanel } from "./TracePanel.tsx";

/**
 * A session's screen with the Mudanças tab beside its conversation (phase 11). Without the tab
 * (a host that does not announce the review, or a session Claude Code has not named yet) the
 * conversation is all there is. The conversation stays mounted under the other tab, so what was
 * typed in its box is still there.
 */
export function SessionTabs(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    /** The Claude Code session id, once known. */
    claudeSessionId: string | null | undefined;
    /** The host announces `review`. */
    enabled: boolean;
    /** Phase 21: the session's id for messages, when the host announces `messaging`. */
    messagingId?: string | null;
    /** Phase 23: the host announces `telemetry`, so the Tempo tab has a timeline to show. */
    telemetry?: boolean;
    /** Phase 25: the host announces `trace`, so the Rastro tab can show the session's tree. */
    trace?: boolean;
    /** Issue #506: the host announces `file.list`, so the Files tab can show the repository's tree. */
    files?: boolean;
    /** Issue #107: which session tab this is (`<host>/<session>`); its last view is kept under it. */
    viewKey?: string;
    /**
     * Issue #107: the Terminal view. `session`: a shell the host opens in this managed session's
     * folder; `launch`: the session started from a terminal, whose PTY the view shows (none while
     * its launch is unknown or its terminal gone). Absent: no Terminal view.
     */
    terminal?: { session: string } | { launch: string | null };
    /** xterm's pieces; the real ones when absent (a test hands in fakes). */
    terminalDeps?: XtermDeps;
    children: ReactNode;
  }>,
) {
  const t = useT();
  const { sessionViews } = props.store;
  const launched = useLaunchTerminal(
    props.store,
    props.hostId,
    props.terminal && "launch" in props.terminal ? props.terminal.launch : null,
  );
  const offered: Record<SessionView, boolean> = {
    conversation: true,
    changes: props.enabled && !!props.claudeSessionId,
    files: !!props.files && !!props.claudeSessionId,
    time: !!props.telemetry && !!props.claudeSessionId,
    trace: !!props.trace && !!props.claudeSessionId,
    messages: !!props.messagingId,
    terminal: props.terminal ? "session" in props.terminal || launched !== null : false,
  };
  const views = SESSION_VIEWS.filter((view) => offered[view]);
  const viewsKey = views.join(",");
  const [chosen, setChosen] = useState<SessionView>(
    () => (props.viewKey ? sessionViews.last(props.viewKey) : null) ?? "conversation",
  );
  // A view the host does not offer (yet) shows the conversation, and what was chosen is kept.
  const tab = views.includes(chosen) ? chosen : "conversation";
  const terminalSource =
    props.terminal && "session" in props.terminal
      ? { session: props.terminal.session }
      : launched
        ? { terminalId: launched }
        : null;
  const bar = views.length > 1;
  const viewKey = props.viewKey;
  // The shell is built when the Terminal view is first shown, and kept (hidden) from then on.
  const [terminalOpened, setTerminalOpened] = useState(false);
  if (tab === "terminal" && !terminalOpened) setTerminalOpened(true);
  const pick = useCallback(
    (view: SessionView) => {
      setChosen(view);
      if (viewKey) sessionViews.remember(viewKey, view);
    },
    [sessionViews, viewKey],
  );
  // The page on screen: the keys and the palette switch its view through the store.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `viewsKey` stands for the `views` list
  useEffect(
    () => sessionViews.register({ key: viewKey ?? "", views, select: pick }),
    [sessionViews, viewKey, viewsKey, pick],
  );
  const root = useRef<HTMLDivElement>(null);
  const tabs = useRef(new Map<SessionView, HTMLButtonElement>());
  // Alt+1 to Alt+7 (Ctrl+1 to 9 are the app's tabs), and Ctrl+` between the Terminal and the Conversation:
  // from anywhere in the page, the message box and the terminal too.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `viewsKey` stands for the `views` list
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      // Only when the key came from this page (or from nowhere): the palette's own Alt keys stay its own.
      const target = event.target as Node | null;
      if (!(target === document.body || (target && root.current?.contains(target)))) return;
      if (event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
        if (event.key !== "`" || !views.includes("terminal")) return;
        event.preventDefault();
        pick(tab === "terminal" ? "conversation" : "terminal");
        return;
      }
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      // On a Mac Alt+1 types a symbol: the physical key says which digit it was.
      const digit =
        /^Digit(\d)$/.exec(event.code)?.[1] ?? (/^\d$/.test(event.key) ? event.key : "");
      const view = views[Number(digit) - 1];
      if (!view) return;
      event.preventDefault();
      pick(view);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewsKey, pick, tab]);
  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = views.indexOf(tab);
    const to =
      event.key === "ArrowRight"
        ? (at + 1) % views.length
        : event.key === "ArrowLeft"
          ? (at - 1 + views.length) % views.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? views.length - 1
              : -1;
    const view = views[to];
    if (!view) return;
    event.preventDefault();
    pick(view);
    tabs.current.get(view)?.focus();
  };
  const base = useId();
  const tabId = (view: SessionView) => `${base}-tab-${view}`;
  const panelId = (view: SessionView) => `${base}-panel-${view}`;
  const panel = (view: SessionView) =>
    bar ? ({ role: "tabpanel", id: panelId(view), "aria-labelledby": tabId(view) } as const) : {};
  // The same elements with or without the bar: the conversation must keep its place in the tree
  // when the bar shows up (Claude Code names the session a moment after it opens), or what was
  // typed in its box is lost with it.
  return (
    <div ref={root} className="flex h-full min-h-0 flex-col">
      {bar && (
        // The views wrap in a narrow pane instead of running past it (#641).
        <div
          data-slot="session-views"
          className="session-views"
          role="tablist"
          aria-label={t("sessionViews.label")}
          tabIndex={-1}
          onKeyDown={onTabKey}
        >
          {views.map((view) => (
            <Button
              key={view}
              ref={(el) => {
                if (el) tabs.current.set(view, el);
                else tabs.current.delete(view);
              }}
              variant="outline"
              size="sm"
              role="tab"
              id={tabId(view)}
              aria-selected={tab === view}
              aria-controls={panelId(view)}
              tabIndex={tab === view ? 0 : -1}
              className="session-view-tab"
              onClick={() => pick(view)}
            >
              {t(VIEW_LABEL[view])}
            </Button>
          ))}
        </div>
      )}
      <div hidden={tab !== "conversation"} className="min-h-0 flex-1" {...panel("conversation")}>
        {props.children}
      </div>
      {terminalOpened && props.viewKey && terminalSource && (
        <div hidden={tab !== "terminal"} className="min-h-0 flex-1" {...panel("terminal")}>
          <SessionTerminal
            store={props.store}
            hostId={props.hostId}
            viewKey={props.viewKey}
            source={terminalSource}
            onClosed={() => {
              setTerminalOpened(false);
              pick("conversation");
            }}
            {...(props.terminalDeps ? { deps: props.terminalDeps } : {})}
          />
        </div>
      )}
      {(tab === "messages" || tab === "time" || tab === "trace" || tab === "files") && (
        <div className="min-h-0 flex-1 overflow-y-auto p-4" {...panel(tab)}>
          {tab === "files" && props.claudeSessionId && (
            <FileExplorer
              store={props.store}
              hostId={props.hostId}
              target={`session:${props.claudeSessionId}`}
            />
          )}
          {tab === "messages" && props.messagingId && (
            <SessionMessages
              store={props.store}
              hostId={props.hostId}
              sessionId={props.messagingId}
            />
          )}
          {tab === "trace" && props.claudeSessionId && (
            <TracePanel
              store={props.store}
              hostId={props.hostId}
              claudeSessionId={props.claudeSessionId}
            />
          )}
          {tab === "time" && props.claudeSessionId && (
            <TempoPanel
              store={props.store}
              hostId={props.hostId}
              claudeSessionId={props.claudeSessionId}
            />
          )}
        </div>
      )}
      {tab === "changes" && props.claudeSessionId && (
        <div
          className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4"
          {...panel("changes")}
        >
          <ChangesPanel
            store={props.store}
            hostId={props.hostId}
            target={`session:${props.claudeSessionId}`}
          />
          <SessionFiles
            store={props.store}
            hostId={props.hostId}
            claudeSessionId={props.claudeSessionId}
          />
        </div>
      )}
    </div>
  );
}
