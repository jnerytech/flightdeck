import type { StepRun, WorkflowInfo } from "@flightdeck/protocol";
import { memo, useEffect, useState } from "react";
import { CardSyncLog } from "@/components/board/board-sync";
import { CardArena } from "@/components/card/card-arena";
import { CardFields } from "@/components/card/card-fields";
import { CardRunForm } from "@/components/card/card-run-form";
import { ActionButton } from "@/components/feedback/action-button";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { Field } from "@/components/layout/form";
import { Page } from "@/components/layout/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PrWatchPanel } from "@/components/watch/pr-watch-panel";
import { useT } from "@/i18n/context";
import { reasonText } from "@/lib/notice-text";
import { useStoreSlice } from "@/lib/use-store";
import { cn } from "@/lib/utils";
import type { Key } from "../i18n/index.ts";
import { type AppStore, sessionKey } from "../lib/app-store.ts";
import { projectCards } from "../lib/board.ts";
import { usd } from "../lib/costs.ts";
import { issueLabel, issueUrl } from "../lib/issues.ts";
import { useSessionState } from "../lib/use-store.ts";
import { hasFeature } from "../lib/version.ts";
import { CardDeps } from "./CardDeps.tsx";
import { CardReview } from "./CardReview.tsx";
import { ChangesPanel } from "./ChangesPanel.tsx";
import { ExternalSeal } from "./IssuesPanel.tsx";
import { PrComments } from "./PrComments.tsx";
import { RunPanel } from "./RunPanel.tsx";
import { RunTimeline } from "./RunTimeline.tsx";
import { SessionView } from "./SessionView.tsx";
import { StatusBadge } from "./StatusBadge.tsx";
import { TerminalButton } from "./TerminalButton.tsx";

const CARDDETAIL_KEYS = ["runs", "personas", "hosts", "cards"] as const;

/** One card: description, runs, the active run's conversation, its diff and the actions. */
export const CardDetail = memo(function CardDetail(props: {
  store: AppStore;
  hostId: string;
  cardId: string;
  /** Opened from the menu's Edit…: the title field takes focus. */
  edit?: boolean;
  onBack(): void;
}) {
  const t = useT();
  const { store, hostId, cardId } = props;
  const state = useStoreSlice(store, CARDDETAIL_KEYS);
  const card = state.cards[sessionKey(hostId, cardId)];
  const [adjustment, setAdjustment] = useState("");
  const [tab, setTab] = useState<"conversation" | "diff">("conversation");
  const sessionId = card?.sessionId ?? null;
  const host = state.hosts.find((h) => h.id === hostId);
  const alwaysAllow = hasFeature(host?.hostInfo?.features, "rules", false);
  const withCosts = hasFeature(host?.hostInfo?.features, "costs", false);
  const withReview = hasFeature(host?.hostInfo?.features, "review", false);
  const withArena = hasFeature(host?.hostInfo?.features, "arena", false);
  const withDeps = hasFeature(host?.hostInfo?.features, "deps", false);
  const withSync = hasFeature(host?.hostInfo?.features, "boardsync", false);
  const withRoi = hasFeature(host?.hostInfo?.features, "roi", false);
  const withPersonas = hasFeature(host?.hostInfo?.features, "personas", false);
  const withWatch = hasFeature(host?.hostInfo?.features, "watch", false);
  /** Estimated cost of every session of the card, and of the open run's (phase 8). */
  const [cardCost, setCardCost] = useState<number | null>(null);
  const [runCost, setRunCost] = useState<number | null>(null);
  const runId = card?.workflowRunId ?? null;
  const run = runId ? state.runs[sessionKey(hostId, runId)] : undefined;
  /** Step opened from the timeline: its conversation or its check output. */
  const [opened, setOpened] = useState<{ stepId: string; attempt: number } | null>(null);
  /** Workflows the card can start with: trusted and valid on the project's base branch. */
  const [workflows, setWorkflows] = useState<WorkflowInfo[]>([]);
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
          {withSync && card.externalUrl && (
            <ActionButton
              variant="outline"
              size="sm"
              onClick={() => store.openLink(card.externalUrl ?? "")}
            >
              {t("boardSyncUi.openItem")}
            </ActionButton>
          )}
          {withSync && card.externalGone && (
            <Badge variant="outline">{t("boardSyncUi.gone")}</Badge>
          )}
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
      <div className={cn("flex flex-col gap-5", chatShown ? "pane-fill" : "max-w-4xl")}>
        {card.notice && (
          <InlineNotice>
            {reasonText(t, card.notice, card.noticeReason, card.noticeParams)}
          </InlineNotice>
        )}
        <CardFields
          store={store}
          hostId={hostId}
          card={card}
          {...(props.edit !== undefined ? { edit: props.edit } : {})}
          withRoi={withRoi}
        />
        {/* Details, then what the card waits for, then how it runs (issue #174). */}
        {withDeps && (
          <CardDeps
            store={store}
            hostId={hostId}
            card={card}
            cards={projectCards(state, hostId, card.projectId)}
            workflows={workflows}
          />
        )}
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
                  bg: hasFeature(host?.hostInfo?.features, "bg", false),
                  watch: withWatch,
                }}
                arenaStart={arena.start}
                onDiscarded={props.onBack}
              />
              {withWatch && card.prUrl && (
                <PrWatchPanel store={store} hostId={hostId} cardId={cardId} />
              )}
              {card.worktreePath && hasFeature(host?.hostInfo?.features, "runenv", false) && (
                <RunPanel store={store} hostId={hostId} card={card} />
              )}
              {arena.view}
            </>
          )}
        </CardArena>
        <Field label={t("cardUi.adjustment")}>
          {(control) => (
            <div className="field-with-action">
              <Textarea
                {...control}
                placeholder={t("cardUi.adjustmentPlaceholder")}
                value={adjustment}
                className="min-h-16 flex-1"
                onChange={(e) => setAdjustment(e.target.value)}
              />
              <Button variant="outline" onClick={sendAdjustment}>
                {t("cardUi.askAdjustment")}
              </Button>
            </div>
          )}
        </Field>
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
              store.respondGate(hostId, { runId: run.id, ...step }, decision, note)
            }
          />
        )}
        {withSync && card.externalUrl && (
          <CardSyncLog store={store} hostId={hostId} cardId={cardId} />
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
            className="card-chat"
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
          <div role="log" aria-label={t("cardUi.cardConversation")} className="card-chat">
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
});
