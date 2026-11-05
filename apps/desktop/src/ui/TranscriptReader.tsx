import type { HistoryMessage, HistorySessionSummary } from "@flightdeck/protocol";
import { Copy } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { IconActionButton } from "@/components/feedback/icon-action-button";
import { Note } from "@/components/layout/note";
import { Message, SessionHeader, SessionPane, Timeline } from "@/components/session/parts";
import { ToolRow } from "@/components/session/tool-row";
import { Button } from "@/components/ui/button";
import { useStoreState } from "@/lib/use-store";
import { cn } from "@/lib/utils";
import type { AppStore } from "../lib/app-store.ts";
import { basename, isInside } from "../lib/paths.ts";
import { messageParts } from "../lib/tool-line.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { Markdown } from "./Markdown.tsx";

/** Which transcript to read, and where to open it (a search hit). */
export interface ReaderTarget {
  hostId: string;
  claudeSessionId: string;
  cursor?: string;
  focusUuid?: string;
}

/** Scrolling closer than this to the end loads the next page. */
const NEAR_END_PX = 80;
/** Within this of the bottom, the reader counts as at the end. */
const END_SLACK_PX = 24;

/** Adds `page` before or after `list`, skipping messages already there (pages may overlap). */
function merge(list: HistoryMessage[], page: HistoryMessage[], where: "before" | "after") {
  const seen = new Set(list.map((m) => m.uuid));
  const fresh = page.filter((m) => !seen.has(m.uuid));
  return where === "before" ? [...fresh, ...list] : [...list, ...fresh];
}

/** Read-only transcript from a host's history, in pages, with the chat's look. */
export function TranscriptReader(
  props: Readonly<{
    store: AppStore;
    target: ReaderTarget;
    hostName: string;
    /** The transcript became a managed session (already selected in the store). */
    onResumed(): void;
  }>,
) {
  const t = props.store.i18n.t;
  const { store, target } = props;
  const [session, setSession] = useState<HistorySessionSummary | null>(null);
  const [messages, setMessages] = useState<HistoryMessage[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [prev, setPrev] = useState<string | null>(null);
  const loading = useRef(false);
  /** Cursor of the latest page read forward: new lines are fetched from there and merged. */
  const lastAfter = useRef(target.cursor ?? "0");
  const atEnd = useRef(false);
  const focused = useRef(false);
  const log = useRef<HTMLDivElement>(null);
  // At the end of what is loaded: the view stays there while messages arrive and the layout settles.
  const following = useRef(target.focusUuid === undefined && target.cursor === undefined);
  const lastHeight = useRef(0);
  const lastFirst = useRef<string | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);
  /** The session's folder is on the host; `null` until it answers. */
  const [cwdExists, setCwdExists] = useState<boolean | null>(null);
  const [allowing, setAllowing] = useState(false);
  const host = useStoreState(store).hosts.find((h) => h.id === target.hostId);
  const roots = host?.info?.allowedRoots ?? [];
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    // Opened on a hit or a cursor it starts there; opened plainly it starts on the latest messages.
    const latest = target.cursor === undefined && target.focusUuid === undefined;
    void store
      .historyGet(target.hostId, target.claudeSessionId, target.cursor, latest)
      .then((page) => {
        if (!live || !page) return;
        if (page.cursor !== undefined) lastAfter.current = page.cursor;
        // Asked for the latest messages and got a page with no cursor: the daemon predates `tail` and sent page one.
        if (latest && page.cursor === undefined) following.current = false;
        setSession(page.session);
        setCwdExists(page.cwdExists ?? null);
        setMessages(page.messages);
        setNext(page.nextCursor);
        atEnd.current = page.nextCursor === null;
        setPrev(page.prevCursor);
      });
    return () => {
      live = false;
    };
  }, [store, target]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the end moves when messages come in
  useLayoutEffect(() => {
    const box = log.current;
    if (!box) return;
    const first = messages[0]?.uuid;
    // Only at the real end of the transcript: a page that is not the last one must not drag the reader past it.
    if (following.current && atEnd.current) box.scrollTop = box.scrollHeight;
    else if (lastFirst.current !== undefined && first !== lastFirst.current) {
      // Older messages came in above what is being read: the view stays on the same message.
      box.scrollTop += box.scrollHeight - lastHeight.current;
    }
    lastFirst.current = first;
    lastHeight.current = box.scrollHeight;
  }, [messages]);
  // Images and code settle after the first paint and push the end down.
  // biome-ignore lint/correctness/useExhaustiveDependencies: new messages add elements to observe
  useLayoutEffect(() => {
    const box = log.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (following.current && atEnd.current) box.scrollTop = box.scrollHeight;
      lastHeight.current = box.scrollHeight;
    });
    observer.observe(box);
    for (const child of Array.from(box.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [messages]);

  // Opens at the hit once its page is on screen.
  useEffect(() => {
    if (focused.current || !target.focusUuid || messages.length === 0) return;
    focused.current = true;
    const items = [...(log.current?.querySelectorAll<HTMLElement>("[data-uuid]") ?? [])];
    items.find((el) => el.dataset.uuid === target.focusUuid)?.scrollIntoView?.({ block: "center" });
  }, [target, messages]);

  const loadPage = async (cursor: string, where: "before" | "after") => {
    if (loading.current) return;
    loading.current = true;
    const page = await store.historyGet(target.hostId, target.claudeSessionId, cursor);
    loading.current = false;
    if (!page) return;
    setMessages((list) => merge(list, page.messages, where));
    if (where === "after") {
      lastAfter.current = cursor;
      atEnd.current = page.nextCursor === null;
      setNext(page.nextCursor);
    } else setPrev(page.prevCursor);
  };

  const loadLatest = useRef(loadPage);
  loadLatest.current = loadPage;
  // Live: a session still being written grows at the end; read it again from the last forward
  // page and merge, without reloading what is on screen.
  useEffect(
    () =>
      store.onHistoryChanged((hostId, change) => {
        if (hostId !== target.hostId || change.claudeSessionId !== target.claudeSessionId) return;
        if (atEnd.current) void loadLatest.current(lastAfter.current, "after");
      }),
    [store, target],
  );

  const resume = async (force: boolean) => {
    setConfirming(false);
    const sessionId = await store.resumeHistory(target.hostId, target.claudeSessionId, force);
    if (sessionId) props.onResumed();
  };

  // Continuing starts a session in the folder: one the host does not allow, or no longer has, cannot.
  const gone = session !== null && cwdExists === false;
  const outside = session !== null && !roots.some((root) => isInside(session.cwd, root));
  const blocked = gone || outside;
  const whyKey = gone ? "reader.gone" : "reader.outside";
  const why = session ? t(whyKey, { folder: session.cwd }) : null;
  return (
    <SessionPane>
      <SessionHeader
        title={session?.title ?? t("external.untitled")}
        {...(session ? { subtitle: `${props.hostName} · ${basename(session.cwd)}` } : {})}
        {...(session
          ? {
              controls: (
                <>
                  {session.maybeActive && (
                    <span className="text-status-needs-you text-xs">{t("reader.maybeActive")}</span>
                  )}
                  <Button
                    size="sm"
                    disabled={blocked}
                    // Two processes writing the same conversation corrupt it: ask first.
                    onClick={() => (session.maybeActive ? setConfirming(true) : void resume(false))}
                  >
                    {t("reader.continue")}
                  </Button>
                  <IconActionButton
                    label={t("reader.copyCommand")}
                    onClick={() =>
                      void store
                        .copyText(`claude --resume ${target.claudeSessionId}`)
                        .then((ok) => setCopied(ok))
                    }
                  >
                    <Copy aria-hidden="true" />
                  </IconActionButton>
                  {copied && (
                    <span className="text-muted-foreground text-xs">{t("reader.copied")}</span>
                  )}
                  {store.embeddedTerminal(target.hostId) && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={blocked}
                      onClick={() =>
                        void store.openClaudeHere(target.hostId, {
                          cwd: session.cwd,
                          claudeSessionId: target.claudeSessionId,
                        })
                      }
                    >
                      {t("claudeHere.resume")}
                    </Button>
                  )}
                </>
              ),
            }
          : {})}
      />
      {session && blocked && (
        <Note>
          <p className="text-status-needs-you">{why}</p>
          {!gone && (
            <Button size="sm" variant="outline" onClick={() => setAllowing(true)}>
              {t("toast.allowRoot")}
            </Button>
          )}
        </Note>
      )}
      {allowing && session && (
        <ConfirmDialog
          message={t("toast.allowRootMessage", { host: props.hostName, folder: session.cwd })}
          confirmLabel={t("toast.allowRoot")}
          onCancel={() => setAllowing(false)}
          onConfirm={() => {
            setAllowing(false);
            void store.allowRoot(target.hostId, session.cwd);
          }}
        />
      )}
      {confirming && (
        <div className="m-3 flex flex-col gap-3 rounded-lg border border-status-needs-you/40 p-4 text-sm">
          <p>{t("reader.confirm")}</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void resume(true)}>
              {t("reader.continueAnyway")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setConfirming(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      )}
      <Timeline
        role="log"
        aria-label={t("reader.transcript")}
        ref={log}
        onScroll={(e) => {
          const el = e.currentTarget;
          following.current = el.scrollHeight - el.scrollTop - el.clientHeight <= END_SLACK_PX;
          lastHeight.current = el.scrollHeight;
          if (next && el.scrollTop + el.clientHeight >= el.scrollHeight - NEAR_END_PX) {
            void loadPage(next, "after");
          }
        }}
      >
        {prev && (
          <Button
            variant="outline"
            size="sm"
            className="self-center"
            onClick={() => void loadPage(prev, "before")}
          >
            {t("reader.loadPrevious")}
          </Button>
        )}
        {messages.map((m) => {
          const focused = m.uuid === target.focusUuid;
          if (m.kind !== "message") {
            return (
              <p
                key={m.uuid}
                data-uuid={m.uuid}
                className="text-center text-muted-foreground text-xs"
                aria-current={focused ? "true" : undefined}
              >
                {m.text}
              </p>
            );
          }
          return (
            <Message
              key={m.uuid}
              from={m.role === "user" ? "user" : "assistant"}
              data-uuid={m.uuid}
              {...(focused ? { "aria-current": "true" as const } : {})}
              className={cn(focused && "ring-2 ring-ring")}
            >
              {m.role === "assistant"
                ? messageParts(m.text).map((part, index) =>
                    part.kind === "tool" ? (
                      <ToolRow
                        // biome-ignore lint/suspicious/noArrayIndexKey: the parts of a stored message do not move
                        key={index}
                        name={part.name}
                        input={part.input}
                        label={t("reader.tool", { name: part.name })}
                      />
                    ) : (
                      // biome-ignore lint/suspicious/noArrayIndexKey: same
                      <Markdown key={index} text={part.text} />
                    ),
                  )
                : m.text}
            </Message>
          );
        })}
      </Timeline>
    </SessionPane>
  );
}
