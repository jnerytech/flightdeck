import type { Card, StepRun } from "@flightdeck/protocol";
import { ActionButton } from "@/components/feedback/action-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import type { AppStore } from "@/lib/app-store";
import type { Key } from "../../i18n/index.ts";
import { issueLabel, issueUrl } from "../../lib/issues.ts";
import type { SessionState } from "../../lib/session-state.ts";
import { CardReview } from "../../ui/CardReview.tsx";
import { ChangesPanel } from "../../ui/ChangesPanel.tsx";
import { ExternalSeal } from "../../ui/IssuesPanel.tsx";
import { PrComments } from "../../ui/PrComments.tsx";
import { SessionView } from "../../ui/SessionView.tsx";
import { StatusBadge } from "../../ui/StatusBadge.tsx";
import { TerminalButton } from "../../ui/TerminalButton.tsx";

/** The card's header actions: back, its state, its issue and synced item, its PR and checks, the terminal. */
export function CardHeaderActions(props: {
  store: AppStore;
  hostId: string;
  card: Card;
  session: SessionState | null;
  withSync: boolean;
  onBack(): void;
}) {
  const t = useT();
  const { store, card, session } = props;
  return (
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
      {props.withSync && card.externalUrl && (
        <ActionButton
          variant="outline"
          size="sm"
          onClick={() => store.openLink(card.externalUrl ?? "")}
        >
          {t("boardSyncUi.openItem")}
        </ActionButton>
      )}
      {props.withSync && card.externalGone && (
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
          hostId={props.hostId}
          target={{ cwd: card.worktreePath, claudeSessionId: session?.claudeSessionId ?? null }}
        />
      )}
    </>
  );
}

export type CardTab = "conversation" | "diff";

/**
 * What the card did: Conversation or Diff, and under it the diff and the PR's comments, a check's
 * output, a step's conversation or the card's own. It always renders, so the conversation keeps
 * its place in the tree (a draft in its composer survives).
 */
export function CardWork(props: {
  store: AppStore;
  hostId: string;
  card: Card;
  tab: CardTab;
  onTab(tab: CardTab): void;
  /** The step opened from the timeline, and its session when it has one. */
  openedStep: StepRun | undefined;
  stepSession: SessionState | null;
  /** The card's own session. */
  session: SessionState | null;
  alwaysAllow: boolean;
  withReview: boolean;
}) {
  const t = useT();
  const { store, hostId, card, tab, openedStep, stepSession, session } = props;
  const cardId = card.id;
  const tabButton = (name: CardTab, label: string) => (
    <Button
      variant="outline"
      size="sm"
      aria-pressed={tab === name}
      className="aria-pressed:bg-accent"
      onClick={() => props.onTab(name)}
    >
      {label}
    </Button>
  );
  return (
    <>
      <div className="flex gap-2">
        {tabButton("conversation", t("cardUi.conversation"))}
        {tabButton("diff", t("cardUi.diff"))}
      </div>
      {tab === "diff" ? (
        <div className="flex flex-col gap-5">
          {card.prUrl && props.withReview && (
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
            alwaysAllow={props.alwaysAllow}
          />
        </div>
      ) : session ? (
        <div role="log" aria-label={t("cardUi.cardConversation")} className="card-chat">
          <SessionView
            title={card.title}
            session={session}
            actions={store}
            t={store.i18n.t}
            nowMs={store.now()}
            focusRequestId={null}
            alwaysAllow={props.alwaysAllow}
          />
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">{t("cardUi.noSession")}</p>
      )}
    </>
  );
}
