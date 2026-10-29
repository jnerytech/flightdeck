import { useMemo, useState } from "react";
import { ApprovalCard } from "@/components/approval/approval-card";
import { type AppState, type AppStore, sessionKey } from "../lib/app-store.ts";
import { STATE_LABELS } from "../lib/hub.ts";
import { basename } from "../lib/paths.ts";
import { hasFeature } from "../lib/version.ts";
import { TerminalButton } from "./TerminalButton.tsx";
import { TranscriptReader } from "./TranscriptReader.tsx";

const STATES = {
  running: STATE_LABELS.running,
  awaiting_permission: STATE_LABELS.needs_you,
  idle: STATE_LABELS.idle,
  unknown: STATE_LABELS.idle,
  ended: STATE_LABELS.ended,
} as const;

/**
 * A live session opened outside Flightdeck: its transcript as it grows, its permission requests
 * inline, and a message box when it runs under `flightdeckd claude` (controllable).
 */
export function ExternalView(props: {
  store: AppStore;
  state: AppState;
  hostId: string;
  hostName: string;
  claudeSessionId: string;
  onResumed(): void;
}) {
  const { store, state, hostId, claudeSessionId: id } = props;
  const key = sessionKey(hostId, id);
  const session = state.externals[key];
  const title = state.meta[key]?.name ?? basename(session?.cwd ?? id);
  const requests = Object.entries(state.externalRequests)
    .filter(([k, request]) => k.startsWith(`${hostId}/`) && request.claudeSessionId === id)
    .map(([, request]) => request);
  const [text, setText] = useState("");
  const host = state.hosts.find((h) => h.id === hostId);
  const alwaysAllow = hasFeature(host?.hostInfo?.features, "rules", false);
  // Stable, or the reader would reload on every render.
  const target = useMemo(() => ({ hostId, claudeSessionId: id }), [hostId, id]);

  const send = () => {
    if (!text.trim()) return;
    void store.hostCommand(hostId, "external.message", { claudeSessionId: id, text: text.trim() });
    setText("");
  };

  return (
    <section className="external">
      <header className="session-header">
        <h2>{title}</h2>
        <span className="muted">{`${props.hostName} · terminal · ${STATES[session?.status ?? "unknown"]}`}</span>
        {session?.controllable && <span className="badge">controlável</span>}
        {session?.cwd && (
          <TerminalButton
            store={store}
            hostId={hostId}
            target={{ cwd: session.cwd, claudeSessionId: id }}
          />
        )}
      </header>
      {requests.map((request) => (
        <ApprovalCard
          key={request.requestId}
          request={{
            requestId: request.requestId,
            toolName: request.toolName,
            input: request.input,
            cwd: session?.cwd ?? null,
            createdAt: request.createdAt,
            ...(request.suggestions ? { suggestions: request.suggestions } : {}),
          }}
          t={store.i18n.t}
          nowMs={store.now()}
          alwaysAllow={alwaysAllow}
          onRespond={(decision, message, updates) =>
            void store.respondTo(hostId, request.requestId, decision, updates, message)
          }
        />
      ))}
      {session?.controllable && (
        <div className="composer">
          <textarea
            aria-label="Mensagem para a sessão"
            placeholder="Mensagem (vai pelo canal do flightdeckd claude)"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="button" className="primary" onClick={send}>
            Enviar mensagem
          </button>
        </div>
      )}
      <TranscriptReader
        key={id}
        store={store}
        target={target}
        hostName={props.hostName}
        onResumed={props.onResumed}
      />
    </section>
  );
}
