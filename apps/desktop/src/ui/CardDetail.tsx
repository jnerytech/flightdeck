import type { Arena, ArenaVariant, StepRun, WorkflowInfo } from "@flightdeck/protocol";
import { useEffect, useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { NativeSelect } from "@/components/layout/form";
import { Page } from "@/components/layout/page";
import { PersonaPicker } from "@/components/personas/persona-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n/context";
import type { Key } from "../i18n/index.ts";
import { type AppState, type AppStore, sessionKey } from "../lib/app-store.ts";
import { usd } from "../lib/costs.ts";
import { issueLabel, issueUrl } from "../lib/issues.ts";
import { useSessionState } from "../lib/use-store.ts";
import { hasFeature } from "../lib/version.ts";
import { ArenaStartForm, type ArenaVariantInput } from "./ArenaStartForm.tsx";
import { ArenaView, variantBusy } from "./ArenaView.tsx";
import { CardReview } from "./CardReview.tsx";
import { ChangesPanel } from "./ChangesPanel.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { ExternalSeal } from "./IssuesPanel.tsx";
import { PrComments } from "./PrComments.tsx";
import { RunTimeline } from "./RunTimeline.tsx";
import { SessionView } from "./SessionView.tsx";
import { StatusBadge } from "./StatusBadge.tsx";
import { TerminalButton } from "./TerminalButton.tsx";

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
  const t = useT();
  const { store, hostId, cardId } = props;
  const card = props.state.cards[sessionKey(hostId, cardId)];
  const [description, setDescription] = useState(card?.description ?? "");
  const [adjustment, setAdjustment] = useState("");
  const [tab, setTab] = useState<"conversation" | "diff">("conversation");
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  /** Phase 13: the arena's comparison, the start form and the variant being chosen. */
  const [arena, setArena] = useState<Arena | null>(null);
  const [arenaForm, setArenaForm] = useState(false);
  const [choosing, setChoosing] = useState<ArenaVariant | null>(null);
  const sessionId = card?.sessionId ?? null;
  const host = props.state.hosts.find((h) => h.id === hostId);
  const alwaysAllow = hasFeature(host?.hostInfo?.features, "rules", false);
  const withCosts = hasFeature(host?.hostInfo?.features, "costs", false);
  const withReview = hasFeature(host?.hostInfo?.features, "review", false);
  const withArena = hasFeature(host?.hostInfo?.features, "arena", false);
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
  /** Phase 20: the persona the card starts in, a picker value. */
  const [persona, setPersona] = useState("");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const projectId = card?.projectId ?? "";
  const chosen = workflows.find((w) => w.name === workflow);
  const openedStep = run?.steps.find(
    (s) => s.stepId === opened?.stepId && s.attempt === opened.attempt,
  );
  const openedSession = useSessionState(store, sessionKey(hostId, openedStep?.sessionId ?? ""));
  const stepSession = openedStep?.sessionId ? openedSession : null;
  const cardSession = useSessionState(store, sessionKey(hostId, sessionId ?? ""));
  const session = sessionId ? cardSession : null;

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

  // The comparison follows the card: again whenever it moves on while it has variants.
  const variants = card?.arenaVariants ?? 0;
  // The variants run on their own and the card does not change with them: read the comparison
  // again every so often until none of them is still working.
  const arenaBusy = arena === null || arena.variants.some(variantBusy);
  useEffect(() => {
    if (!withArena || variants === 0 || !cardMoment || !arenaBusy) return;
    const load = () => void store.hostCommand(hostId, "card.arena", { cardId }).then(setArena);
    load();
    const timer = setInterval(load, 1000);
    return () => clearInterval(timer);
  }, [store, hostId, cardId, withArena, variants, cardMoment, arenaBusy]);

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

  // A route straight to a card (a link, a notification) has not loaded its board: ask the host.
  const missing = card === undefined;
  useEffect(() => {
    if (missing) void store.hostCommand(hostId, "card.get", { cardId });
  }, [store, hostId, cardId, missing]);

  if (!card) return <p className="p-6 text-muted-foreground text-sm">{t("cardUi.notFound")}</p>;

  const askDiscard = async () => {
    const current = card.worktreePath
      ? await store.hostCommand(hostId, "card.diff", { cardId })
      : null;
    const files = current?.files ?? [];
    const unsent = files.some((f) => f.uncommitted) || (files.length > 0 && !card.prUrl);
    setConfirming({ kind: "discard", warning: unsent ? t("cardUi.unsent") : null });
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

  const startArena = async (list: ArenaVariantInput[]) => {
    setArenaForm(false);
    const variants = list.map(({ persona, ...rest }) => {
      const ref = persona ? store.personaRef(persona) : null;
      return { ...rest, ...(ref ? { persona: ref } : {}) };
    });
    setArena(await store.hostCommand(hostId, "card.startArena", { cardId, variants }));
  };

  const chooseVariant = async () => {
    const variant = choosing;
    setChoosing(null);
    if (!variant) return;
    const chosen = await store.hostCommand(hostId, "card.chooseVariant", {
      cardId,
      variantId: variant.id,
      confirm: true,
    });
    if (chosen) setArena(null);
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

  return (
    <Page
      title={card.title}
      subtitle={
        cardCost !== null ? (
          <span>
            {t("session.cost")} <output aria-label={t("cardUi.cost")}>{usd(cardCost)}</output>
          </span>
        ) : undefined
      }
      actions={
        <>
          <Button variant="outline" size="sm" onClick={props.onBack}>
            {t("cardUi.back")}
          </Button>
          {card.sessionStatus && <StatusBadge status={card.sessionStatus} />}
          {card.queued && <Badge variant="outline">{t("kanban.queued")}</Badge>}
          {card.issueRef && (
            <ActionButton
              variant="outline"
              size="sm"
              disabled={!issueUrl(card.issueRef)}
              disabledReason={t("cardUi.noIssueLink")}
              aria-label={t("issuesUi.openIssue", { issue: issueLabel(card.issueRef) })}
              onClick={() => store.openLink(issueUrl(card.issueRef as string) ?? "")}
            >
              {issueLabel(card.issueRef)}
            </ActionButton>
          )}
          {card.issueExternal && <ExternalSeal t={t} />}
          {card.prState && <Badge variant="outline">{t(`pr.${card.prState}` as Key)}</Badge>}
          {card.checksState && (
            <Badge variant="outline">{t(`checks.${card.checksState}` as Key)}</Badge>
          )}
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
            aria-label={t("cardUi.description")}
            value={description}
            className="min-h-20 flex-1"
            onChange={(e) => setDescription(e.target.value)}
          />
          <ActionButton
            variant="outline"
            onClick={() => store.hostCommand(hostId, "card.update", { cardId, description })}
          >
            {t("cardUi.saveDescription")}
          </ActionButton>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect
            inline
            aria-label={t("cardUi.workflow")}
            value={workflow}
            onChange={(e) => {
              setWorkflow(e.target.value);
              setInputs({});
            }}
          >
            <option value="">{t("cardUi.noWorkflow")}</option>
            {workflows.map((w) => (
              <option key={w.name} value={w.name}>
                {w.name}
              </option>
            ))}
          </NativeSelect>
          {chosen?.inputs.map((name) => (
            <Input
              key={name}
              aria-label={t("cardUi.input", { name })}
              placeholder={name}
              className="w-48"
              value={inputs[name] ?? ""}
              onChange={(e) => setInputs({ ...inputs, [name]: e.target.value })}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {hasFeature(host?.hostInfo?.features, "personas", false) && (
            <PersonaPicker
              store={store}
              hostId={hostId}
              label={t("personas.picker.card")}
              value={persona}
              onChange={setPersona}
            />
          )}
          <ActionButton
            onClick={() => {
              const ref = store.personaRef(persona);
              return store.hostCommand(hostId, "card.start", {
                cardId,
                ...(chosen ? { workflow: chosen.name, inputs } : {}),
                ...(ref ? { persona: ref } : {}),
              });
            }}
          >
            {t("cardUi.start")}
          </ActionButton>
          <ActionButton
            variant="outline"
            onClick={() => store.hostCommand(hostId, "card.stop", { cardId })}
          >
            {t("cardUi.stop")}
          </ActionButton>
          <ActionButton
            variant="outline"
            disabled={!card.worktreePath || Boolean(card.prUrl)}
            disabledReason={t(card.prUrl ? "cardUi.prAlreadyOpen" : "cardUi.needWorktree")}
            onClick={() => store.hostCommand(hostId, "card.pr.create", { cardId })}
          >
            {t("cardUi.openPr")}
          </ActionButton>
          <Button
            variant="outline"
            onClick={() => setConfirming({ kind: "complete", warning: null })}
          >
            {t("cardUi.complete")}
          </Button>
          {withArena &&
            variants === 0 &&
            !card.arenaOf &&
            !card.worktreePath &&
            !card.queued &&
            !arena && (
              <Button variant="outline" onClick={() => setArenaForm(true)}>
                {t("arenaUi.start")}
              </Button>
            )}
          <Button variant="destructive" onClick={() => void askDiscard()}>
            {t("cardUi.discard")}
          </Button>
        </div>
        {confirming && (
          <ConfirmDialog
            message={
              confirming.kind === "complete"
                ? t("cardUi.completeMessage")
                : t("cardUi.discardMessage")
            }
            warning={confirming.warning}
            confirmLabel={
              confirming.kind === "complete"
                ? t("cardUi.completeConfirm")
                : t("cardUi.discardConfirm")
            }
            destructive={confirming.kind === "discard"}
            onConfirm={() => void confirm()}
            onCancel={() => setConfirming(null)}
          />
        )}
        {arenaForm && (
          <ArenaStartForm
            onStart={(list) => void startArena(list)}
            onClose={() => setArenaForm(false)}
            {...(hasFeature(host?.hostInfo?.features, "personas", false) && {
              persona: (n: number, value: string, onChange: (value: string) => void) => (
                <PersonaPicker
                  store={store}
                  hostId={hostId}
                  label={t("arenaUi.persona", { n })}
                  value={value}
                  onChange={onChange}
                />
              ),
            })}
          />
        )}
        {choosing && (
          <ConfirmDialog
            message={t("arenaUi.chooseMessage", { name: choosing.label })}
            confirmLabel={t("arenaUi.chooseConfirm")}
            destructive
            onConfirm={() => void chooseVariant()}
            onCancel={() => setChoosing(null)}
          />
        )}
        {arena && (
          <ArenaView
            arena={arena}
            loadDiff={(variantId) => store.hostCommand(hostId, "card.diff", { cardId: variantId })}
            onChoose={setChoosing}
            personaName={(id) =>
              props.state.personas[hostId]?.find((p) => p.id === id)?.name ??
              store.globalPersonas.list().find((p) => p.id === id)?.name ??
              id
            }
          />
        )}
        <div className="flex items-start gap-2">
          <Textarea
            aria-label={t("cardUi.adjustment")}
            placeholder={t("cardUi.adjustmentPlaceholder")}
            value={adjustment}
            className="min-h-16 flex-1"
            onChange={(e) => setAdjustment(e.target.value)}
          />
          <Button variant="outline" onClick={sendAdjustment}>
            {t("cardUi.askAdjustment")}
          </Button>
        </div>
        <section className="flex flex-col gap-2">
          <h3 className="font-semibold text-sm">{t("cardUi.runs")}</h3>
          <ul
            aria-label={t("cardUi.runs")}
            className="flex flex-col gap-1 text-muted-foreground text-xs"
          >
            {card.runs.map((run, i) => (
              <li key={run.queuedAt} className="tabular-nums">
                {[
                  `#${i + 1}`,
                  store.formatDateTime(run.queuedAt),
                  run.endedAt
                    ? t("cardUi.runEnded")
                    : run.startedAt
                      ? t("cardUi.runActive")
                      : t("cardUi.runQueued"),
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
            {t("cardUi.conversation")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-pressed={tab === "diff"}
            className="aria-pressed:bg-accent"
            onClick={() => setTab("diff")}
          >
            {t("cardUi.diff")}
          </Button>
        </div>
        {tab === "diff" ? (
          <div className="flex flex-col gap-5">
            {card.prUrl && withReview && (
              <PrComments
                store={store}
                hostId={hostId}
                cardId={cardId}
                moment={`${card.updatedAt}/${card.prState}`}
              />
            )}
            <ChangesPanel
              store={store}
              hostId={hostId}
              target={`card:${cardId}`}
              extra={(changes, refresh) => (
                <CardReview
                  store={store}
                  hostId={hostId}
                  card={card}
                  changes={changes}
                  refresh={refresh}
                />
              )}
            />
          </div>
        ) : openedStep?.type === "check" ? (
          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground text-xs">
              {t("cardUi.exitCode", { code: openedStep.exitCode ?? "" })}
            </p>
            <section aria-label={t("cardUi.checkOutput", { step: openedStep.stepId })}>
              <pre className="overflow-x-auto rounded-md border bg-muted p-3 font-mono text-xs">
                {openedStep.output}
              </pre>
            </section>
          </div>
        ) : openedStep && stepSession ? (
          <div
            role="log"
            aria-label={t("cardUi.stepConversation", { step: openedStep.stepId })}
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
            aria-label={t("cardUi.cardConversation")}
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
          <p className="text-muted-foreground text-sm">{t("cardUi.noSession")}</p>
        )}
      </div>
    </Page>
  );
}
