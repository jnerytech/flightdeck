import type { StepRun, WorkflowInfo } from "@flightdeck/protocol";
import { memo, useEffect, useState } from "react";
import { CardSyncLog } from "@/components/board/board-sync";
import { CardAdjustment, CardRuns } from "@/components/card/card-adjustment";
import { CardArena } from "@/components/card/card-arena";
import { CardFields } from "@/components/card/card-fields";
import { CardPins } from "@/components/card/card-pins";
import { CardRunForm } from "@/components/card/card-run-form";
import { CardHeaderActions, type CardTab, CardWork } from "@/components/card/card-work";
import { PostMortem } from "@/components/card/post-mortem";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { Page } from "@/components/layout/page";
import { PrWatchPanel } from "@/components/watch/pr-watch-panel";
import { useT } from "@/i18n/context";
import { reasonText } from "@/lib/notice-text";
import { useStoreSlice } from "@/lib/use-store";
import { cn } from "@/lib/utils";
import { type AppStore, sessionKey } from "../lib/app-store.ts";
import { projectCards } from "../lib/board.ts";
import { usd } from "../lib/costs.ts";
import { useSessionState } from "../lib/use-store.ts";
import { hasFeature } from "../lib/version.ts";
import { CardDeps } from "./CardDeps.tsx";
import { RunPanel } from "./RunPanel.tsx";
import { GateCard, RunTimeline } from "./RunTimeline.tsx";

const CARDDETAIL_KEYS = ["runs", "personas", "hosts", "cards", "projects"] as const;

/** One card: description, runs, the active run's conversation, its diff and the actions. */
export const CardDetail = memo(function CardDetail(props: {
  store: AppStore;
  hostId: string;
  cardId: string;
  /** Opened from the menu's Edit…: the title field takes focus. */
  edit?: boolean;
  /** Opens Settings, section Assistant (the wand found no provider). */
  onOpenSettings(): void;
  onBack(): void;
  /** Opens another card of the project (the post-mortem that was just started). */
  onOpenCard(cardId: string): void;
}) {
  const t = useT();
  const { store, hostId, cardId } = props;
  const state = useStoreSlice(store, CARDDETAIL_KEYS);
  const card = state.cards[sessionKey(hostId, cardId)];
  const [tab, setTab] = useState<CardTab>("conversation");
  const sessionId = card?.sessionId ?? null;
  const host = state.hosts.find((h) => h.id === hostId);
  const has = (feature: string) => hasFeature(host?.hostInfo?.features, feature, false);
  const alwaysAllow = has("rules");
  const withCosts = has("costs");
  const withReview = has("review");
  const withArena = has("arena");
  const withDeps = has("deps");
  const withSync = has("boardsync");
  const withRoi = has("roi");
  const withPersonas = has("personas");
  const withWatch = has("watch");
  /** Estimated cost of every session of the card, and of the open run's (phase 8). */
  const [cardCost, setCardCost] = useState<number | null>(null);
  const [runCost, setRunCost] = useState<number | null>(null);
  const runId = card?.workflowRunId ?? null;
  const run = runId ? state.runs[sessionKey(hostId, runId)] : undefined;
  /** Step opened from the timeline: its conversation or its check output. */
  const [opened, setOpened] = useState<{ stepId: string; attempt: number } | null>(null);
  /** Workflows the card can start with: trusted and valid on the project's base branch. */
  const [workflows, setWorkflows] = useState<WorkflowInfo[]>([]);
  /** The host has answered `workflow.list`: until then an empty list means nothing. */
  const [workflowsKnown, setWorkflowsKnown] = useState(false);
  const projectId = card?.projectId ?? "";
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

  useEffect(() => {
    // The project is known once the card is (a direct route loads it).
    if (!projectId) return;
    void store.hostCommand(hostId, "workflow.list", { projectId }).then((result) => {
      setWorkflows((result?.workflows ?? []).filter((w) => w.trusted && w.errors.length === 0));
      setWorkflowsKnown(result !== null);
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

  const openStep = (step: StepRun) => {
    setTab("conversation");
    setOpened({ stepId: step.stepId, attempt: step.attempt });
    if (step.sessionId) store.select(hostId, step.sessionId);
  };

  /**
   * The conversation is on show: it takes what is left of the pane. The page always fills (#249):
   * a page that switched to fill mounted its body again, and lost what was typed in it.
   */
  const chatShown =
    tab === "conversation" &&
    openedStep?.type !== "check" &&
    Boolean((openedStep && stepSession) || (session && sessionId));
  return (
    <Page
      fill
      title={card.title}
      subtitle={
        cardCost !== null ? (
          <span>
            {t("session.cost")} <output aria-label={t("cardUi.cost")}>{usd(cardCost)}</output>
          </span>
        ) : undefined
      }
      actions={
        <CardHeaderActions
          store={store}
          hostId={hostId}
          card={card}
          session={session}
          withSync={withSync}
          onBack={props.onBack}
        />
      }
    >
      <div className={cn("flex flex-col gap-5", chatShown ? "pane-fill" : "max-w-4xl")}>
        {/* Once the conversation shows, everything above it is a pane of its own that scrolls by
            itself, so the page body never scrolls around the conversation's timeline (#641). The
            same element either way: what was typed in it stays (#249). */}
        <section
          data-slot="card-info"
          data-split={chatShown}
          aria-label={chatShown ? t("cardUi.infoPane") : undefined}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a pane that scrolls takes focus, so the keyboard reaches it
          tabIndex={chatShown ? 0 : undefined}
          className="card-info"
        >
          {card.notice && (
            <InlineNotice>
              {reasonText(t, card.notice, card.noticeReason, card.noticeParams)}
            </InlineNotice>
          )}
          {/* Issue #227: a gate waiting for the person is the first thing on the card, not under the form. */}
          {run?.steps
            .filter((step) => step.type === "gate" && step.status === "waiting")
            .map((step) => (
              <GateCard
                key={`${step.stepId}/${step.attempt}`}
                step={step}
                onRespond={(gate, decision, note) =>
                  store.respondGate(hostId, { runId: run.id, ...gate }, decision, note)
                }
              />
            ))}
          <PostMortem
            store={store}
            hostId={hostId}
            card={card}
            run={run ?? null}
            claudeSessionId={session?.claudeSessionId ?? null}
            workflows={workflowsKnown ? workflows : null}
            onOpenCard={props.onOpenCard}
          />
          {/* How it runs, then the details, then what the card waits for: the card's next step
              (Start, Stop, Open PR) is the first thing on it, not under the form (#732). */}
          <CardArena
            store={store}
            hostId={hostId}
            card={card}
            enabled={withArena}
            personas={withPersonas}
            moment={cardMoment}
            personaName={(id) =>
              state.personas[hostId]?.find((p) => p.id === id)?.name ??
              store.globalPersonas.list().find((p) => p.id === id)?.name ??
              id
            }
          >
            {(arena) => (
              <>
                <CardRunForm
                  store={store}
                  hostId={hostId}
                  card={card}
                  workflows={workflows}
                  features={{
                    personas: withPersonas,
                    bg: has("bg"),
                    watch: withWatch,
                  }}
                  arenaStart={arena.start}
                  onDiscarded={props.onBack}
                  onShowDiff={() => setTab("diff")}
                />
                {withWatch && card.prUrl && (
                  <PrWatchPanel store={store} hostId={hostId} cardId={cardId} />
                )}
                {card.worktreePath && has("runenv") && (
                  <RunPanel store={store} hostId={hostId} card={card} />
                )}
                {arena.view}
              </>
            )}
          </CardArena>
          <CardFields
            store={store}
            hostId={hostId}
            card={card}
            {...(props.edit !== undefined ? { edit: props.edit } : {})}
            withRoi={withRoi}
            onOpenSettings={props.onOpenSettings}
          />
          {has("cardPins") && (
            <CardPins
              store={store}
              hostId={hostId}
              card={card}
              path={state.projects[hostId]?.find((p) => p.id === card.projectId)?.path ?? null}
              library={has("knowledge")}
            />
          )}
          {withDeps && (
            <CardDeps
              store={store}
              hostId={hostId}
              card={card}
              cards={projectCards(state, hostId, card.projectId)}
              workflows={workflows}
            />
          )}
          <CardAdjustment
            store={store}
            hostId={hostId}
            cardId={cardId}
            {...(card.worktreePath ? { cwd: card.worktreePath } : {})}
            onOpenSettings={props.onOpenSettings}
          />
          <CardRuns runs={card.runs} formatDateTime={(iso) => store.formatDateTime(iso)} />
          {run && (
            <RunTimeline
              run={run}
              formatTime={(iso) => store.formatTime(iso)}
              costUsd={runCost}
              onOpenStep={openStep}
            />
          )}
          {withSync && card.externalUrl && (
            <CardSyncLog store={store} hostId={hostId} cardId={cardId} />
          )}
        </section>
        <CardWork
          store={store}
          hostId={hostId}
          card={card}
          tab={tab}
          onTab={setTab}
          openedStep={openedStep}
          stepSession={stepSession}
          session={session}
          alwaysAllow={alwaysAllow}
          withReview={withReview}
        />
      </div>
    </Page>
  );
});
