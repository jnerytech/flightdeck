import type { HistoryMessage, HistorySessionSummary } from "@flightdeck/protocol";
import { useEffect, useRef, useState } from "react";
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

function itemClass(message: HistoryMessage): string {
  if (message.kind !== "message") return "muted transcript-note";
  return message.role === "user" ? "msg msg-user" : "msg msg-assistant";
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
    <section className="session">
      <header className="session-header">
        <div>
          <h2>{session?.title ?? target.claudeSessionId}</h2>
          {session && <div className="muted">{`${props.hostName} · ${basename(session.cwd)}`}</div>}
        </div>
        {session && (
          <div className="session-controls">
            {session.maybeActive && <span className="badge badge-warn">possivelmente em uso</span>}
            <button
              type="button"
              className="primary"
              // Two processes writing the same conversation corrupt it: ask first.
              onClick={() => (session.maybeActive ? setConfirming(true) : void resume(false))}
            >
              Continuar no Flightdeck
            </button>
            <button
              type="button"
              onClick={() =>
                void store
                  .copyText(`claude --resume ${target.claudeSessionId}`)
                  .then((ok) => setCopied(ok))
              }
            >
              Copiar comando
            </button>
            {copied && <span className="muted">Comando copiado</span>}
          </div>
        )}
      </header>
      {confirming && (
        <div className="card confirm">
          <p>
            Esta sessão pode estar em uso em outro lugar: o arquivo mudou nos últimos 2 minutos.
            Dois processos escrevendo na mesma conversa a corrompem.
          </p>
          <button type="button" className="primary" onClick={() => void resume(true)}>
            Continuar mesmo assim
          </button>
          <button type="button" onClick={() => setConfirming(false)}>
            Cancelar
          </button>
        </div>
      )}
      <div
        className="timeline"
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
          <button type="button" onClick={() => void loadPage(prev, "before")}>
            Carregar anteriores
          </button>
        )}
        {messages.map((m) => (
          <div
            key={m.uuid}
            data-uuid={m.uuid}
            className={itemClass(m)}
            aria-current={m.uuid === target.focusUuid ? "true" : undefined}
          >
            {m.role === "assistant" ? <Markdown text={m.text} /> : m.text}
          </div>
        ))}
      </div>
    </section>
  );
}
