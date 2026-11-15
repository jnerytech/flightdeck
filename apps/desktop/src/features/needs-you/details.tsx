import type { ReactNode, RefObject } from "react";
import { Button } from "@/components/ui/button";
import { ApprovalCard, GateText } from "@/features/permissions/ui.ts";
import { CONTINUATION, type Finish } from "@/features/sessions/index.ts";
import { ActionButton } from "@/shared/feedback/index.ts";
import { Inline, Stack } from "@/shared/layout/index.ts";
import { formatAgo } from "../../i18n/format.ts";
import type { Key, T } from "../../i18n/index.ts";
import type { AppStore, PendingItem } from "../../lib/app-store.ts";
import type { Route } from "../../lib/router.ts";
import { type LoopAlert, loopPairKey } from "../messaging/index.ts";
import type { WatchAlert } from "../watch/index.ts";
import { pendingText, pendingWhere } from "./domain/pending-text.ts";
import { type QuietAlert, quietText } from "./domain/quiet.ts";
import type { Entry } from "./domain/same-row.ts";
import { hostNameOf } from "./entry-row.tsx";

/** The right-hand side for something that is not a request: a column that scrolls by itself. */
function DetailColumn(props: Readonly<{ children: ReactNode }>) {
  return <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">{props.children}</div>;
}

/** How many files a finished session changed, in words; null when the host did not say. */
function filesText(t: T, files: number | null): string | null {
  if (files === null) return null;
  if (files === 0) return t("needsYou.finishedNoFiles");
  if (files === 1) return t("needsYou.finishedFilesOne");
  return t("needsYou.finishedFilesMany", { n: files });
}

/** A session that finished: how, when, how many files it changed, and the way to its Changes. */
function FinishedDetail(
  props: Readonly<{ finish: Finish; store: AppStore; go(route: Route): void }>,
) {
  const { finish, store, go } = props;
  const { t } = store.i18n;
  const outcome = t(`needsYou.finishedOutcome.${finish.outcome}` as Key);
  const files = filesText(t, finish.files);
  return (
    <DetailColumn>
      <h2 className="font-semibold text-base">{finish.name}</h2>
      <p className="text-sm">
        {hostNameOf(store, finish.hostId)} · {outcome} ·{" "}
        {formatAgo(store.now() - Date.parse(finish.at), t)}
      </p>
      {files && <p className="text-sm">{files}</p>}
      <Inline gap={2}>
        <Button
          onClick={() => {
            store.sessionViews.remember(finish.key, "changes");
            go({ name: "session", host: finish.hostId, id: finish.sessionId });
          }}
        >
          {t("needsYou.seeChanges")}
        </Button>
      </Inline>
    </DetailColumn>
  );
}

/** A card whose watch needs the person: why, the rounds so far, and the ways on. */
function WatchDetail(
  props: Readonly<{ alert: WatchAlert; store: AppStore; go(route: Route): void }>,
) {
  const { alert, store, go } = props;
  const { t } = store.i18n;
  return (
    <DetailColumn>
      <h2 className="font-semibold text-base">{t("watchUi.notifyTitle")}</h2>
      <p className="text-sm">{alert.title}</p>
      <p className="text-sm">{t("watchUi.needsYou", { reason: alert.watch.reason ?? "" })}</p>
      <Stack as="ul" gap={1} className="text-sm">
        {alert.watch.rounds.map((round) => (
          <li key={round.id}>
            {t("watchUi.round", { n: round.n, status: t(`watchUi.status.${round.status}` as Key) })}
            {round.summary ? ` — ${round.summary}` : ""}
          </li>
        ))}
      </Stack>
      <Inline gap={2}>
        <ActionButton onClick={() => store.prWatch.set(alert.hostId, alert.cardId, true)}>
          {t("watchUi.resume")}
        </ActionButton>
        {alert.projectId && (
          <Button
            variant="outline"
            onClick={() =>
              go({
                name: "card",
                host: alert.hostId,
                projectId: alert.projectId as string,
                cardId: alert.cardId,
              })
            }
          >
            {t("watchUi.openCard")}
          </Button>
        )}
      </Inline>
    </DetailColumn>
  );
}

/** Two sessions that keep answering each other: the message, and the way to let them go on. */
function LoopDetail(props: Readonly<{ alert: LoopAlert; store: AppStore }>) {
  const { alert, store } = props;
  const { t } = store.i18n;
  return (
    <DetailColumn>
      <h2 className="font-semibold text-base">{t("needsYou.loopTitle")}</h2>
      <p className="text-sm">{alert.message}</p>
      <div>
        <Button onClick={() => void store.messaging.releasePair(alert.hostId, loopPairKey(alert))}>
          {t("needsYou.release")}
        </Button>
      </div>
    </DetailColumn>
  );
}

/** A running session that says nothing: how long, and the four ways on (#1478). */
function QuietDetail(
  props: Readonly<{ alert: QuietAlert; store: AppStore; go(route: Route): void; onActed(): void }>,
) {
  const { alert, store, go } = props;
  const { t } = store.i18n;
  return (
    <DetailColumn>
      <h2 className="font-semibold text-base">{t("needsYou.quietTitle")}</h2>
      <p className="text-sm">
        {alert.hostName} · {alert.title}
      </p>
      <p className="text-sm">{quietText(alert, store.now(), t)}</p>
      <p className="text-muted-foreground text-sm">{t("needsYou.quietBody")}</p>
      <Inline gap={2}>
        <Button onClick={() => go({ name: "session", host: alert.hostId, id: alert.sessionId })}>
          {t("needsYou.quietOpen")}
        </Button>
        <ActionButton
          variant="outline"
          onClick={() => {
            props.onActed();
            return store.commands.interruptOn(alert.hostId, alert.sessionId);
          }}
        >
          {t("needsYou.quietInterrupt")}
        </ActionButton>
        <ActionButton
          variant="outline"
          onClick={() => {
            props.onActed();
            return store.commands.sendTo(alert.hostId, alert.sessionId, CONTINUATION);
          }}
        >
          {t("needsYou.quietContinue")}
        </ActionButton>
        <Button
          variant="outline"
          onClick={() => {
            props.onActed();
            store.quietSnooze.snooze(alert.hostId, alert.sessionId);
          }}
        >
          {t("needsYou.quietSnooze")}
        </Button>
      </Inline>
    </DetailColumn>
  );
}

/** The ways to act on a request besides answering it: its secret rule, or open its session. */
function RequestActions(
  props: Readonly<{
    item: PendingItem;
    store: AppStore;
    go(route: Route): void;
    onOpenRequest(item: PendingItem): void;
  }>,
) {
  const { item, store, go } = props;
  const { t } = store.i18n;
  // A request for a secret belongs to no session: the card is all there is to open.
  if (item.vault) {
    return (
      <>
        {item.vaultOnce && (
          <ActionButton
            variant="outline"
            onClick={() => store.vaultApprovals.approveForSession(item.hostId, item.requestId)}
          >
            {t("vaultRulesUi.approveSession")}
          </ActionButton>
        )}
        <Button
          variant="ghost"
          onClick={() => item.vaultRule && go({ name: "vault", rule: item.vaultRule })}
        >
          {t("vaultRulesUi.fromRequest")}
        </Button>
      </>
    );
  }
  return (
    <Button variant="ghost" onClick={() => props.onOpenRequest(item)}>
      {t(item.gate ? "approval.openCard" : "approval.openSession")}
    </Button>
  );
}

/**
 * A terminal session at a plan or a question (#1751): the person answers it there, so the app says
 * what it waits for and opens the session. There is no request to approve.
 */
function WaitDetail(props: Readonly<{ item: PendingItem; t: T; onOpen(item: PendingItem): void }>) {
  const { item, t } = props;
  return (
    <Stack gap={2}>
      <p className="text-sm">{pendingText(item, t)}</p>
      <div>
        <Button variant="outline" onClick={() => props.onOpen(item)}>
          {t("approval.openSession")}
        </Button>
      </div>
    </Stack>
  );
}

/** The chosen request: how many are left, and its approval card. */
function RequestDetail(
  props: Readonly<{
    item: PendingItem;
    left: number;
    detailBox: RefObject<HTMLDivElement | null>;
    store: AppStore;
    go(route: Route): void;
    onOpenRequest(item: PendingItem): void;
  }>,
) {
  const { item, store, go } = props;
  const { t } = store.i18n;
  const toolName = item.gate ? t("needsYou.gateTool", { step: item.gate.stepId }) : item.toolName;
  const gateBody = item.gateText ? { body: <GateText {...item.gateText} /> } : {};
  return (
    <div ref={props.detailBox} className="h-full overflow-y-auto p-4">
      <Stack gap={2}>
        <p className="text-muted-foreground text-xs">
          {props.left === 1 ? t("needsYou.leftOne") : t("needsYou.leftMany", { n: props.left })}
        </p>
        <p className="text-sm">{pendingWhere(item)}</p>
        {item.waiting ? (
          <WaitDetail item={item} t={t} onOpen={props.onOpenRequest} />
        ) : (
          <ApprovalCard
            key={item.requestId}
            request={{
              requestId: item.requestId,
              toolName,
              input: item.input ?? {},
              cwd: item.cwd ?? null,
              createdAt: item.createdAt,
              ...(item.risk ? { risk: item.risk } : {}),
              ...(item.riskReason ? { riskReason: item.riskReason } : {}),
            }}
            t={t}
            nowMs={store.now()}
            onCopyPath={(text) => void store.system.copyText(text)}
            {...gateBody}
            onRespond={(decision, message, _updates, updatedInput, held) => {
              if (item.gate) {
                const verdict = decision === "allow" ? "approve" : "reject";
                return store.respondGate(item.hostId, item.gate, verdict, message);
              }
              return store.respondTo(item.hostId, item.requestId, decision, {
                message,
                updatedInput,
                held,
              });
            }}
            actions={
              <RequestActions
                item={item}
                store={store}
                go={go}
                onOpenRequest={props.onOpenRequest}
              />
            }
          />
        )}
      </Stack>
    </div>
  );
}

/** The right-hand side for the chosen line, by its kind (a budget alert has none). */
export function Detail(
  props: Readonly<{
    chosen: Exclude<Entry, { kind: "alert" }>;
    requests: number;
    detailBox: RefObject<HTMLDivElement | null>;
    store: AppStore;
    go(route: Route): void;
    onOpenRequest(item: PendingItem): void;
    onQuietActed(): void;
  }>,
) {
  const { chosen, store, go } = props;
  if (chosen.kind === "quiet")
    return <QuietDetail alert={chosen.alert} store={store} go={go} onActed={props.onQuietActed} />;
  if (chosen.kind === "watch") return <WatchDetail alert={chosen.alert} store={store} go={go} />;
  if (chosen.kind === "loop") return <LoopDetail alert={chosen.alert} store={store} />;
  if (chosen.kind === "finished")
    return <FinishedDetail finish={chosen.finish} store={store} go={go} />;
  return (
    <RequestDetail
      item={chosen.item}
      left={props.requests}
      detailBox={props.detailBox}
      store={store}
      go={go}
      onOpenRequest={props.onOpenRequest}
    />
  );
}
