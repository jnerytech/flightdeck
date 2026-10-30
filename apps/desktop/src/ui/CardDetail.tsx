import type { CardDiff, StepRun, WorkflowInfo } from "@flightdeck/protocol";
import { useEffect, useState } from "react";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { Page } from "@/components/layout/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { type AppState, type AppStore, sessionKey } from "../lib/app-store.ts";
import { CHECK_LABELS, PR_LABELS } from "../lib/board.ts";
import { usd } from "../lib/costs.ts";
import { emptySession } from "../lib/session-state.ts";
import { hasFeature } from "../lib/version.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { DiffView } from "./DiffView.tsx";
import { when } from "./GlobalSearch.tsx";
import { RunTimeline } from "./RunTimeline.tsx";
import { SessionView } from "./SessionView.tsx";
import { StatusBadge } from "./StatusBadge.tsx";
import { TerminalButton } from "./TerminalButton.tsx";

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
  const host = props.state.hosts.find((h) => h.id === hostId);
  const alwaysAllow = hasFeature(host?.hostInfo?.features, "rules", false);
  const withCosts = hasFeature(host?.hostInfo?.features, "costs", false);
  /** Estimated cost of every session of the card, and of the open run's (phase 8). */
  const [cardCost, setCardCost] = useState<number | null>(null);
  const [runCost, setRunCost] = useState<number | null>(null);
  const runId = card?.workflowRunId ?? null;
  const run = runId ? props.state.runs[sessionKey(hostId, runId)] : undefined;
  /** Step opened from the timeline: its conversation or its check output. */
  const [opened, setOpened] = useState<{ stepId: string; attempt: number } | null>(null);
  /** Workflows the card can start with: trusted and valid on the project's base branch. */
  const [workflows, setWorkflows] = useState<WorkflowInfo[]>([]);
  const [workflow, setWorkflow] = useState("");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const projectId = card?.projectId ?? "";
  const chosen = workflows.find((w) => w.name === workflow);
  const openedStep = run?.steps.find(
    (s) => s.stepId === opened?.stepId && s.attempt === opened.attempt,
  );

  // Again whenever the card or its run moves on.
  const cardMoment = `${card?.updatedAt}/${run?.status}/${run?.steps.length}`;
  useEffect(() => {
    if (!withCosts || !cardMoment) return;
    void store
      .hostCommand(hostId, "costs.card", { cardId })
      .then((r) => setCardCost(r?.costUsd ?? null));
    if (runId) {
      void store
        .hostCommand(hostId, "costs.run", { runId })
        .then((r) => setRunCost(r?.costUsd ?? null));
    }
  }, [store, hostId, cardId, runId, withCosts, cardMoment]);

  useEffect(() => {
    // The project is known once the card is (a direct route loads it).
    if (!projectId) return;
    void store.hostCommand(hostId, "workflow.list", { projectId }).then((result) => {
      setWorkflows((result?.workflows ?? []).filter((w) => w.trusted && w.errors.length === 0));
    });
  }, [store, hostId, projectId]);

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

  // A route straight to a card (a link, a notification) has not loaded its board: ask the host.
  const missing = card === undefined;
  useEffect(() => {
    if (missing) void store.hostCommand(hostId, "card.get", { cardId });
  }, [store, hostId, cardId, missing]);

  if (!card) return <p className="p-6 text-muted-foreground text-sm">Card não encontrado.</p>;

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

  const SELECT =
    "h-9 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <Page
      title={card.title}
      subtitle={
        cardCost !== null ? (
          <span>
            custo estimado: <output aria-label="Custo do card">{usd(cardCost)}</output>
          </span>
        ) : undefined
      }
      actions={
        <>
          <Button variant="outline" size="sm" onClick={props.onBack}>
            Voltar ao board
          </Button>
          {card.sessionStatus && <StatusBadge status={card.sessionStatus} />}
          {card.queued && <Badge variant="outline">na fila</Badge>}
          {card.prState && <Badge variant="outline">{PR_LABELS[card.prState]}</Badge>}
          {card.checksState && <Badge variant="outline">{CHECK_LABELS[card.checksState]}</Badge>}
          {/* The worktree, resuming the card's session once Claude Code named it. */}
          {card.worktreePath && (!session || session.claudeSessionId) && (
            <TerminalButton
              store={store}
              hostId={hostId}
              target={{ cwd: card.worktreePath, claudeSessionId: session?.claudeSessionId ?? null }}
            />
          )}
        </>
      }
    >
      <div className="flex max-w-4xl flex-col gap-5">
        {card.notice && <InlineNotice>{card.notice}</InlineNotice>}
        <div className="flex items-start gap-2">
          <Textarea
            aria-label="Descrição"
            value={description}
            className="min-h-20 flex-1"
            onChange={(e) => setDescription(e.target.value)}
          />
          <Button
            variant="outline"
            onClick={() => void store.hostCommand(hostId, "card.update", { cardId, description })}
          >
            Salvar descrição
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Workflow"
            className={SELECT}
            value={workflow}
            onChange={(e) => {
              setWorkflow(e.target.value);
              setInputs({});
            }}
          >
            <option value="">Nenhum (card simples)</option>
            {workflows.map((w) => (
              <option key={w.name} value={w.name}>
                {w.name}
              </option>
            ))}
          </select>
          {chosen?.inputs.map((name) => (
            <Input
              key={name}
              aria-label={`Input ${name}`}
              placeholder={name}
              className="w-48"
              value={inputs[name] ?? ""}
              onChange={(e) => setInputs({ ...inputs, [name]: e.target.value })}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() =>
              void store.hostCommand(hostId, "card.start", {
                cardId,
                ...(chosen ? { workflow: chosen.name, inputs } : {}),
              })
            }
          >
            Iniciar
          </Button>
          <Button
            variant="outline"
            onClick={() => void store.hostCommand(hostId, "card.stop", { cardId })}
          >
            Parar
          </Button>
          <Button
            variant="outline"
            onClick={() => void store.hostCommand(hostId, "card.pr.create", { cardId })}
          >
            Abrir PR
          </Button>
          <Button
            variant="outline"
            onClick={() => setConfirming({ kind: "complete", warning: null })}
          >
            Concluir
          </Button>
          <Button variant="destructive" onClick={() => void askDiscard()}>
            Descartar
          </Button>
        </div>
        {confirming && (
          <ConfirmDialog
            message={
              confirming.kind === "complete"
                ? "Concluir este card? A worktree é removida se não houver alterações pendentes."
                : "Descartar este card? A worktree e a branch local são apagadas."
            }
            warning={confirming.warning}
            confirmLabel={confirming.kind === "complete" ? "Concluir card" : "Descartar card"}
            destructive={confirming.kind === "discard"}
            onConfirm={() => void confirm()}
            onCancel={() => setConfirming(null)}
          />
        )}
        <div className="flex items-start gap-2">
          <Textarea
            aria-label="Ajuste"
            placeholder="O que ajustar"
            value={adjustment}
            className="min-h-16 flex-1"
            onChange={(e) => setAdjustment(e.target.value)}
          />
          <Button variant="outline" onClick={sendAdjustment}>
            Pedir ajuste
          </Button>
        </div>
        <section className="flex flex-col gap-2">
          <h3 className="font-semibold text-sm">Execuções</h3>
          <ul aria-label="Execuções" className="flex flex-col gap-1 text-muted-foreground text-xs">
            {card.runs.map((run, i) => (
              <li key={run.queuedAt} className="tabular-nums">
                {[
                  `#${i + 1}`,
                  when(run.queuedAt),
                  run.endedAt ? "encerrada" : run.startedAt ? "ativa" : "na fila",
                ].join(" · ")}
              </li>
            ))}
          </ul>
        </section>
        {run && (
          <RunTimeline
            run={run}
            formatTime={(iso) => store.formatTime(iso)}
            costUsd={runCost}
            onOpenStep={openStep}
            onRespond={(step, decision, note) =>
              void store.respondGate(hostId, { runId: run.id, ...step }, decision, note)
            }
          />
        )}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-pressed={tab === "conversation"}
            className="aria-pressed:bg-accent"
            onClick={() => setTab("conversation")}
          >
            Conversa
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-pressed={tab === "diff"}
            className="aria-pressed:bg-accent"
            onClick={() => setTab("diff")}
          >
            Diff
          </Button>
        </div>
        {tab === "diff" ? (
          diff && <DiffView diff={diff} />
        ) : openedStep?.type === "check" ? (
          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground text-xs">{`código ${openedStep.exitCode}`}</p>
            <section aria-label={`Saída do check ${openedStep.stepId}`}>
              <pre className="overflow-x-auto rounded-md border bg-muted p-3 font-mono text-xs">
                {openedStep.output}
              </pre>
            </section>
          </div>
        ) : openedStep && stepSession ? (
          <div
            role="log"
            aria-label={`Conversa da etapa ${openedStep.stepId}`}
            className="h-[32rem] overflow-hidden rounded-lg border"
          >
            <SessionView
              title={`${card.title} · ${openedStep.stepId}`}
              session={stepSession}
              actions={store}
              t={store.i18n.t}
              nowMs={store.now()}
              focusRequestId={null}
              alwaysAllow={alwaysAllow}
            />
          </div>
        ) : session && sessionId ? (
          <div
            role="log"
            aria-label="Conversa do card"
            className="h-[32rem] overflow-hidden rounded-lg border"
          >
            <SessionView
              title={card.title}
              session={session}
              actions={store}
              t={store.i18n.t}
              nowMs={store.now()}
              focusRequestId={null}
              alwaysAllow={alwaysAllow}
            />
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">Sem sessão ainda.</p>
        )}
      </div>
    </Page>
  );
}
