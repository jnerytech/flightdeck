import type { CardDiff, StepRun } from "@flightdeck/protocol";
import { useEffect, useState } from "react";
import { type AppState, type AppStore, sessionKey } from "../lib/app-store.ts";
import { CHECK_LABELS, PR_LABELS } from "../lib/board.ts";
import { emptySession } from "../lib/session-state.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { DiffView } from "./DiffView.tsx";
import { when } from "./GlobalSearch.tsx";
import { RunTimeline } from "./RunTimeline.tsx";
import { SessionView } from "./SessionView.tsx";
import { StatusBadge } from "./StatusBadge.tsx";

const UNSENT = "Há alterações não enviadas que serão perdidas.";

interface Confirming {
  kind: "complete" | "discard";
  warning: string | null;
}

/** One card: description, runs, the active run's conversation, its diff and the actions. */
export function CardDetail(props: {
  store: AppStore;
  state: AppState;
  hostId: string;
  cardId: string;
  onBack(): void;
}) {
  const { store, hostId, cardId } = props;
  const card = props.state.cards[sessionKey(hostId, cardId)];
  const [description, setDescription] = useState(card?.description ?? "");
  const [adjustment, setAdjustment] = useState("");
  const [tab, setTab] = useState<"conversation" | "diff">("conversation");
  const [diff, setDiff] = useState<CardDiff | null>(null);
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const sessionId = card?.sessionId ?? null;
  const runId = card?.workflowRunId ?? null;
  const run = runId ? props.state.runs[sessionKey(hostId, runId)] : undefined;
  /** Step opened from the timeline: its conversation or its check output. */
  const [opened, setOpened] = useState<{ stepId: string; attempt: number } | null>(null);
  const openedStep = run?.steps.find(
    (s) => s.stepId === opened?.stepId && s.attempt === opened.attempt,
  );

  // The run follows run.updated; this fetch covers a run that changed before the app watched.
  useEffect(() => {
    if (runId) void store.hostCommand(hostId, "run.get", { runId });
  }, [store, hostId, runId]);

  // The conversation is the regular session view: selecting the session subscribes to it.
  useEffect(() => {
    if (sessionId) store.select(hostId, sessionId);
  }, [store, hostId, sessionId]);

  useEffect(() => {
    if (tab !== "diff") return;
    void store.hostCommand(hostId, "card.diff", { cardId }).then(setDiff);
  }, [store, hostId, cardId, tab]);

  if (!card) return <p className="muted welcome">Card não encontrado.</p>;

  const askDiscard = async () => {
    const current = card.worktreePath
      ? await store.hostCommand(hostId, "card.diff", { cardId })
      : null;
    const files = current?.files ?? [];
    const unsent = files.some((f) => f.uncommitted) || (files.length > 0 && !card.prUrl);
    setConfirming({ kind: "discard", warning: unsent ? UNSENT : null });
  };

  const confirm = async () => {
    const kind = confirming?.kind;
    setConfirming(null);
    if (kind === "complete") {
      await store.hostCommand(hostId, "card.complete", { cardId, confirm: true });
    } else {
      const discarded = await store.hostCommand(hostId, "card.discard", { cardId, confirm: true });
      if (discarded) props.onBack();
    }
  };

  const sendAdjustment = () => {
    if (!adjustment.trim()) return;
    void store.hostCommand(hostId, "card.message", { cardId, text: adjustment.trim() });
    setAdjustment("");
  };

  const openStep = (step: StepRun) => {
    setTab("conversation");
    setOpened({ stepId: step.stepId, attempt: step.attempt });
    if (step.sessionId) store.select(hostId, step.sessionId);
  };
  const stepSession = openedStep?.sessionId
    ? (props.state.sessions[sessionKey(hostId, openedStep.sessionId)] ?? emptySession())
    : null;

  const session = sessionId
    ? (props.state.sessions[sessionKey(hostId, sessionId)] ?? emptySession())
    : null;

  return (
    <section className="card-detail">
      <header className="row">
        <button type="button" onClick={props.onBack}>
          Voltar ao board
        </button>
        <h2>{card.title}</h2>
        {card.sessionStatus && <StatusBadge status={card.sessionStatus} />}
        {card.queued && <span className="badge badge-muted">na fila</span>}
        {card.prState && <span className="badge">{PR_LABELS[card.prState]}</span>}
        {card.checksState && <span className="badge">{CHECK_LABELS[card.checksState]}</span>}
      </header>
      {card.notice && <p className="notice">{card.notice}</p>}
      <div className="row">
        <textarea
          aria-label="Descrição"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <button
          type="button"
          onClick={() => void store.hostCommand(hostId, "card.update", { cardId, description })}
        >
          Salvar descrição
        </button>
      </div>
      <div className="row actions">
        <button
          type="button"
          className="primary"
          onClick={() => void store.hostCommand(hostId, "card.start", { cardId })}
        >
          Iniciar
        </button>
        <button
          type="button"
          onClick={() => void store.hostCommand(hostId, "card.stop", { cardId })}
        >
          Parar
        </button>
        <button
          type="button"
          onClick={() => void store.hostCommand(hostId, "card.pr.create", { cardId })}
        >
          Abrir PR
        </button>
        <button type="button" onClick={() => setConfirming({ kind: "complete", warning: null })}>
          Concluir
        </button>
        <button type="button" className="danger" onClick={() => void askDiscard()}>
          Descartar
        </button>
      </div>
      {confirming && (
        <ConfirmDialog
          message={
            confirming.kind === "complete"
              ? "Concluir este card? A worktree é removida se não houver alterações pendentes."
              : "Descartar este card? A worktree e a branch local são apagadas."
          }
          warning={confirming.warning}
          onConfirm={() => void confirm()}
          onCancel={() => setConfirming(null)}
        />
      )}
      <div className="row">
        <textarea
          aria-label="Ajuste"
          placeholder="O que ajustar"
          value={adjustment}
          onChange={(e) => setAdjustment(e.target.value)}
        />
        <button type="button" onClick={sendAdjustment}>
          Pedir ajuste
        </button>
      </div>
      <h3>Execuções</h3>
      <ul aria-label="Execuções">
        {card.runs.map((run, i) => (
          <li key={run.queuedAt}>
            {[
              `#${i + 1}`,
              when(run.queuedAt),
              run.endedAt ? "encerrada" : run.startedAt ? "ativa" : "na fila",
            ].join(" · ")}
          </li>
        ))}
      </ul>
      {run && <RunTimeline run={run} onOpenStep={openStep} />}
      <div className="row">
        <button
          type="button"
          aria-pressed={tab === "conversation"}
          onClick={() => setTab("conversation")}
        >
          Conversa
        </button>
        <button type="button" aria-pressed={tab === "diff"} onClick={() => setTab("diff")}>
          Diff
        </button>
      </div>
      {tab === "diff" ? (
        diff && <DiffView diff={diff} />
      ) : openedStep?.type === "check" ? (
        <div className="check-output">
          <p className="muted">{`código ${openedStep.exitCode}`}</p>
          <section aria-label={`Saída do check ${openedStep.stepId}`}>
            <pre>{openedStep.output}</pre>
          </section>
        </div>
      ) : openedStep && stepSession ? (
        <div role="log" aria-label={`Conversa da etapa ${openedStep.stepId}`}>
          <SessionView
            title={`${card.title} · ${openedStep.stepId}`}
            session={stepSession}
            actions={store}
            focusRequestId={null}
          />
        </div>
      ) : session && sessionId ? (
        <div role="log" aria-label="Conversa do card">
          <SessionView title={card.title} session={session} actions={store} focusRequestId={null} />
        </div>
      ) : (
        <p className="muted">Sem sessão ainda.</p>
      )}
    </section>
  );
}
