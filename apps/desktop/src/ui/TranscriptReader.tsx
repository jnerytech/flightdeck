import type { HistoryMessage, HistorySessionSummary } from "@flightdeck/protocol";
import { useEffect, useRef, useState } from "react";
import { Message, SessionHeader, SessionPane, Timeline } from "@/components/session/parts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AppStore } from "../lib/app-store.ts";
import { basename } from "../lib/paths.ts";
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

/** Adds `page` before or after `list`, skipping messages already there (pages may overlap). */
function merge(list: HistoryMessage[], page: HistoryMessage[], where: "before" | "after") {
  const seen = new Set(list.map((m) => m.uuid));
  const fresh = page.filter((m) => !seen.has(m.uuid));
  return where === "before" ? [...fresh, ...list] : [...list, ...fresh];
}

/** Read-only transcript from a host's history, in pages, with the chat's look. */
export function TranscriptReader(props: {
  store: AppStore;
  target: ReaderTarget;
  hostName: string;
  /** The transcript became a managed session (already selected in the store). */
  onResumed(): void;
}) {
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
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    void store.historyGet(target.hostId, target.claudeSessionId, target.cursor).then((page) => {
      if (!live || !page) return;
      setSession(page.session);
      setMessages(page.messages);
      setNext(page.nextCursor);
      atEnd.current = page.nextCursor === null;
      setPrev(page.prevCursor);
    });
    return () => {
      live = false;
    };
  }, [store, target]);

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

  return (
    <SessionPane>
      <SessionHeader
        title={session?.title ?? target.claudeSessionId}
        {...(session ? { subtitle: `${props.hostName} · ${basename(session.cwd)}` } : {})}
        {...(session
          ? {
              controls: (
                <>
                  {session.maybeActive && (
                    <span className="text-status-needs-you text-xs">possivelmente em uso</span>
                  )}
                  <Button
                    size="sm"
                    // Two processes writing the same conversation corrupt it: ask first.
                    onClick={() => (session.maybeActive ? setConfirming(true) : void resume(false))}
                  >
                    Continuar no Flightdeck
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      void store
                        .copyText(`claude --resume ${target.claudeSessionId}`)
                        .then((ok) => setCopied(ok))
                    }
                  >
                    Copiar comando
                  </Button>
                  {copied && <span className="text-muted-foreground text-xs">Comando copiado</span>}
                </>
              ),
            }
          : {})}
      />
      {confirming && (
        <div className="m-3 flex flex-col gap-3 rounded-lg border border-status-needs-you/40 p-4 text-sm">
          <p>
            Esta sessão pode estar em uso em outro lugar: o arquivo mudou nos últimos 2 minutos.
            Dois processos escrevendo na mesma conversa a corrompem.
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void resume(true)}>
              Continuar mesmo assim
            </Button>
            <Button variant="outline" size="sm" onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
      <Timeline
        role="log"
        aria-label="Transcript"
        ref={log}
        onScroll={(e) => {
          const el = e.currentTarget;
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
            Carregar anteriores
          </Button>
        )}
        {messages.map((m) =>
          m.kind !== "message" ? (
            <p
              key={m.uuid}
              data-uuid={m.uuid}
              className="text-center text-muted-foreground text-xs"
              aria-current={m.uuid === target.focusUuid ? "true" : undefined}
            >
              {m.text}
            </p>
          ) : (
            <Message
              key={m.uuid}
              from={m.role === "user" ? "user" : "assistant"}
              data-uuid={m.uuid}
              {...(m.uuid === target.focusUuid ? { "aria-current": "true" as const } : {})}
              className={cn(m.uuid === target.focusUuid && "ring-2 ring-ring")}
            >
              {m.role === "assistant" ? <Markdown text={m.text} /> : m.text}
            </Message>
          ),
        )}
      </Timeline>
    </SessionPane>
  );
}
