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
import { SessionFinish } from "../components/session/session-finish.tsx";
import type { AppStore } from "../lib/app-store.ts";
import {
  offeredViews,
  type SessionView,
  tabKeyIndex,
  terminalLaunch,
  terminalSourceOf,
  VIEW_LABEL,
  type ViewKey,
  viewKeyTarget,
} from "../lib/session-views.ts";
import { useLaunchTerminal } from "../lib/use-launch-terminal.ts";
import type { XtermDeps } from "../lib/xterm-screen.ts";
import { ChangesPanel } from "./ChangesPanel.tsx";
import { FileExplorer } from "./FileExplorer.tsx";
import { SessionFiles } from "./SessionFiles.tsx";
import { SessionMessages } from "./SessionMessages.tsx";
import { SessionTerminal } from "./SessionTerminal.tsx";
import { TempoPanel } from "./TempoPanel.tsx";
import { TracePanel } from "./TracePanel.tsx";

/** Where the view keys are not for the page: a field being typed in, a dialog (the palette). */
const TYPING_OR_DIALOG = "input, textarea, select, [contenteditable], [role=dialog]";

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
    /** The page's conversation takes text handed to its message box (a managed session's does). */
    reviewToComposer?: boolean;
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
  const launched = useLaunchTerminal(props.store, props.hostId, terminalLaunch(props.terminal));
  const views = offeredViews({
    enabled: props.enabled,
    files: props.files,
    telemetry: props.telemetry,
    trace: props.trace,
    claudeSessionId: props.claudeSessionId,
    messagingId: props.messagingId,
    terminal: props.terminal,
    launched,
  });
  const viewsKey = views.join(",");
  const [chosen, setChosen] = useState<SessionView>(
    () => (props.viewKey ? sessionViews.last(props.viewKey) : null) ?? "conversation",
  );
  // A view the host does not offer (yet) shows the conversation, and what was chosen is kept.
  const tab = views.includes(chosen) ? chosen : "conversation";
  const terminalSource = terminalSourceOf(props.terminal, launched);
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
  // Alt+1 to Alt+7 (Ctrl+1 to 9 are the app's tabs), and Ctrl+` between the Terminal and the Conversation.
  // `true` when the key was one of them and the view changed.
  const viewKeyHandler = useRef<((event: ViewKey & { preventDefault(): void }) => boolean) | null>(
    null,
  );
  viewKeyHandler.current = (event) => {
    const view = viewKeyTarget(event, views, tab);
    if (!view) return false;
    event.preventDefault();
    pick(view);
    return true;
  };
  // From anywhere in the page, the message box too (the terminal has its own, below).
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      // From this page, from nowhere, or from the list row that opened it (the focus stays there, #885).
      // Not from a text field or a dialog: the palette's own Alt keys stay its own.
      const target = event.target as Element | null;
      const here = target === document.body || (target && root.current?.contains(target));
      if (!here && target?.closest?.(TYPING_OR_DIALOG) !== null) return;
      viewKeyHandler.current?.(event);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = views.indexOf(tab);
    const to = tabKeyIndex(event.key, at, views.length);
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
        // Capture phase: xterm listens on its own text box and would send the key to the shell, so the
        // page takes the view keys first and stops them there.
        <div
          hidden={tab !== "terminal"}
          className="min-h-0 flex-1"
          onKeyDownCapture={(event) => {
            if (viewKeyHandler.current?.(event.nativeEvent)) event.stopPropagation();
          }}
          {...panel("terminal")}
        >
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
            {...(viewKey && props.reviewToComposer
              ? {
                  onCompose: (text: string) => {
                    props.store.fillComposer(viewKey, text);
                    pick("conversation");
                    props.store.success(t("changes.composed"));
                  },
                }
              : {})}
            extra={(changes, refresh) => (
              <SessionFinish
                store={props.store}
                hostId={props.hostId}
                target={changes.target}
                changes={changes}
                refresh={refresh}
              />
            )}
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
