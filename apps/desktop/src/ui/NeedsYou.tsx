import { CheckCheck, MousePointerClick } from "lucide-react";
import { useEffect, useState } from "react";
import { ApprovalCard } from "@/components/approval/approval-card";
import { SplitView } from "@/components/layout/split-view";
import { EmptyState } from "@/components/layout/states";
import { StatusDot } from "@/components/status/status-dot";
import { Button } from "@/components/ui/button";
import { formatAgo } from "../i18n/format.ts";
import {
  type AppState,
  type AppStore,
  type LoopAlert,
  loopPairKey,
  needsYou,
  type PendingItem,
} from "../lib/app-store.ts";
import { budgetAlerts } from "../lib/budgets.ts";
import { typing } from "../lib/keys.ts";
import type { Route } from "../lib/router.ts";
import { inputSummary } from "../lib/tool-input.ts";

/** A line of the list: a budget alert (opens Settings), a paused loop or a request (shows its card). */
type Entry =
  | { kind: "alert"; key: string; label: string }
  | { kind: "loop"; key: string; alert: LoopAlert }
  | { kind: "request"; key: string; item: PendingItem };

const ROW =
  "flex w-full min-w-0 flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[active=true]:bg-accent aria-pressed:bg-accent";

/** The requests waiting for the user: the list on the left, the chosen request's card on the right. */
export function NeedsYou(props: {
  store: AppStore;
  state: AppState;
  go(route: Route): void;
  onOpenRequest(item: PendingItem): void;
}) {
  const { store, state, go } = props;
  const { t } = store.i18n;
  const entries: Entry[] = [
    ...budgetAlerts(state, t).map((a) => ({
      kind: "alert" as const,
      key: `alert/${a.hostId}/${a.label}`,
      label: a.label,
    })),
    ...state.loopAlerts.map((alert) => ({
      kind: "loop" as const,
      key: `loop/${alert.hostId}/${loopPairKey(alert)}`,
      alert,
    })),
    ...needsYou(state).map((item) => ({
      kind: "request" as const,
      key: `${item.hostId}/${item.requestId}`,
      item,
    })),
  ];
  const [selected, setSelected] = useState<string | null>(null);
  /** The row the keyboard is on (-1: none yet). */
  const [cursor, setCursor] = useState(-1);
  const chosen = entries.find((e) => e.key === selected);
  const open = (entry: Entry) => {
    if (entry.kind === "alert") go({ name: "settings" });
    else setSelected(entry.key);
  };

  // J and K move the cursor, Enter opens the row under it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      if (e.key === "j") setCursor(Math.min(entries.length - 1, cursor + 1));
      else if (e.key === "k") setCursor(Math.max(0, cursor - 1));
      else if (e.key === "Enter" && entries[cursor]) open(entries[cursor] as Entry);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (entries.length === 0) {
    return (
      <section className="flex h-full flex-col gap-4 p-6">
        <h1 className="font-semibold text-xl">{t("needsYou.title")}</h1>
        <EmptyState
          icon={CheckCheck}
          title={t("needsYou.empty")}
          action={
            <Button variant="outline" onClick={() => go({ name: "hub" })}>
              {t("needsYou.seeSessions")}
            </Button>
          }
        />
      </section>
    );
  }

  const list = (
    <section className="flex h-full min-h-0 flex-col">
      <div className="flex items-baseline gap-2 border-b px-4 py-3">
        <h1 className="font-semibold text-base">{t("needsYou.title")}</h1>
        <span className="text-muted-foreground text-xs tabular-nums">{entries.length}</span>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-2">
        {entries.map((entry, i) => {
          if (entry.kind === "alert") {
            return (
              <li key={entry.key}>
                <button
                  type="button"
                  data-active={cursor === i}
                  className={ROW}
                  onClick={() => {
                    setCursor(i);
                    open(entry);
                  }}
                >
                  <span className="truncate text-sm">{entry.label}</span>
                </button>
              </li>
            );
          }
          if (entry.kind === "loop") {
            return (
              <li key={entry.key}>
                <button
                  type="button"
                  aria-pressed={selected === entry.key}
                  data-active={cursor === i}
                  className={ROW}
                  onClick={() => {
                    setCursor(i);
                    open(entry);
                  }}
                >
                  <span className="flex items-center gap-2">
                    <StatusDot tone="needs-you" label={t("hub.stateDots.needs_you")} />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {t("needsYou.loopRow", { from: entry.alert.from, to: entry.alert.to })}
                    </span>
                  </span>
                </button>
              </li>
            );
          }
          const { item } = entry;
          const summary = inputSummary(item.input);
          return (
            <li key={entry.key}>
              <button
                type="button"
                aria-label={`${item.hostName} · ${item.sessionName}: ${item.toolName}`}
                aria-pressed={selected === entry.key}
                data-active={cursor === i}
                className={ROW}
                onClick={() => {
                  setCursor(i);
                  open(entry);
                }}
              >
                <span className="flex items-center gap-2">
                  <StatusDot tone="needs-you" label={t("hub.stateDots.needs_you")} />
                  <span className="min-w-0 flex-1 truncate text-sm">{`${item.hostName} · ${item.sessionName}`}</span>
                  <time
                    dateTime={item.createdAt}
                    className="shrink-0 text-muted-foreground text-xs tabular-nums"
                  >
                    {formatAgo(store.now() - Date.parse(item.createdAt), t)}
                  </time>
                </span>
                <span className="truncate pl-4 text-muted-foreground text-xs">
                  {summary ? `${item.toolName}: ${summary}` : item.toolName}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );

  const item = chosen?.kind === "request" ? chosen.item : null;
  const loop = chosen?.kind === "loop" ? chosen.alert : null;
  const detail = loop ? (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      <h2 className="font-semibold text-base">{t("needsYou.loopTitle")}</h2>
      <p className="text-sm">{loop.message}</p>
      <div>
        <Button onClick={() => void store.releasePair(loop.hostId, loopPairKey(loop))}>
          {t("needsYou.release")}
        </Button>
      </div>
    </div>
  ) : (
    item && (
      <div className="h-full overflow-y-auto p-4">
        <ApprovalCard
          request={{
            requestId: item.requestId,
            toolName: item.toolName,
            input: item.input ?? {},
            cwd: item.cwd ?? null,
            createdAt: item.createdAt,
            ...(item.risk ? { risk: item.risk } : {}),
            ...(item.riskReason ? { riskReason: item.riskReason } : {}),
          }}
          t={t}
          nowMs={store.now()}
          onCopyPath={(text) => void store.copyText(text)}
          onRespond={(decision, message) =>
            item.gate
              ? void store.respondGate(
                  item.hostId,
                  item.gate,
                  decision === "allow" ? "approve" : "reject",
                  message,
                )
              : void store.respondTo(item.hostId, item.requestId, decision, undefined, message)
          }
          actions={
            // A request for a secret belongs to no session: the card is all there is to open.
            item.vault ? (
              <>
                {item.vaultOnce && (
                  <Button
                    variant="outline"
                    onClick={() => void store.approveVaultForSession(item.hostId, item.requestId)}
                  >
                    {t("vaultRulesUi.approveSession")}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  onClick={() => item.vaultRule && go({ name: "vault", rule: item.vaultRule })}
                >
                  {t("vaultRulesUi.fromRequest")}
                </Button>
              </>
            ) : (
              <Button variant="ghost" onClick={() => props.onOpenRequest(item)}>
                {t(item.gate ? "approval.openCard" : "approval.openSession")}
              </Button>
            )
          }
        />
      </div>
    )
  );

  return (
    <SplitView
      list={list}
      detail={detail}
      empty={
        <div className="flex h-full items-center justify-center p-6">
          <EmptyState icon={MousePointerClick} title={t("needsYou.choose")} />
        </div>
      }
      onClose={() => setSelected(null)}
      labels={{ resize: t("needsYou.resize") }}
      initialWidth={store.listWidth()}
      onResize={(width) => store.setListWidth(width)}
    />
  );
}
