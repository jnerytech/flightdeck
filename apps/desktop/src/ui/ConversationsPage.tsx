import type { MessageInfo, MessageStatus } from "@flightdeck/protocol";
import { MessagesSquare } from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";
import { NativeSelect } from "@/components/layout/form";
import { Page } from "@/components/layout/page";
import { Toolbar } from "@/components/layout/stack";
import { EmptyState } from "@/components/layout/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useStoreSlice } from "@/lib/use-store";
import type { AppStore } from "../lib/app-store.ts";
import type { Route } from "../lib/router.ts";
import { hasFeature } from "../lib/version.ts";

const STATUSES: MessageStatus[] = ["delivered", "queued", "refused", "expired", "pending"];
const TONE: Record<MessageStatus, string> = {
  delivered: "text-status-idle",
  queued: "text-muted-foreground",
  pending: "text-muted-foreground",
  refused: "text-status-error",
  expired: "text-status-needs-you",
};

/** A message as the timeline shows it: where it was read from, and the session to open. */
interface Row {
  hostId: string;
  hostName: string;
  message: MessageInfo;
}

const CONVERSATIONSPAGE_KEYS = ["hosts"] as const;

/**
 * Phase 21: the messages between sessions on every host with messaging, newest first, with their
 * state and why one was refused. A message relayed between hosts is listed once.
 */
export const ConversationsPage = memo(function ConversationsPage(props: {
  store: AppStore;
  go(route: Route): void;
}) {
  const { store } = props;
  const state = useStoreSlice(store, CONVERSATIONSPAGE_KEYS);
  const { t } = store.i18n;
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState<"" | MessageStatus>("");
  const [text, setText] = useState("");
  const hosts = state.hosts.filter(
    (h) => h.status === "online" && hasFeature(h.hostInfo?.features, "messaging", false),
  );
  const hostKey = hosts.map((h) => h.id).join("|");

  const load = useCallback(async () => {
    const found = new Map<string, Row>();
    const ids = hostKey.split("|");
    for (const host of store.getState().hosts) {
      if (!ids.includes(host.id)) continue;
      const result = await store.hostCommand(host.id, "messages.list", {});
      for (const message of result?.messages ?? []) {
        // A relayed message is on both daemons: the recipient's copy has the final state.
        const seen = found.get(message.id);
        if (!seen || message.toHost === host.hostInfo?.hostName) {
          found.set(message.id, { hostId: host.id, hostName: host.name, message });
        }
      }
    }
    setRows(
      [...found.values()].sort((a, b) => b.message.createdAt.localeCompare(a.message.createdAt)),
    );
  }, [store, hostKey]);
  useEffect(() => {
    void load();
    return store.onMessageUpdated(() => void load());
  }, [store, load]);

  const needle = text.trim().toLowerCase();
  const shown = rows.filter(({ message: m, hostName }) => {
    if (status && m.status !== status) return false;
    if (!needle) return true;
    return [m.text, m.fromSession, m.toSession, m.fromHost, m.toHost, m.teamId ?? "", hostName]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });

  const openSession = (row: Row) => {
    const { message } = row;
    const host = state.hosts.find((h) => h.hostInfo?.hostName === message.toHost) ?? null;
    if (!host) return;
    const managed = host.sessions.some((s) => s.id === message.toSession);
    props.go(
      managed
        ? { name: "session", host: host.id, id: message.toSession }
        : { name: "external", host: host.id, claudeSessionId: message.toSession },
    );
  };

  return (
    <Page
      title={t("conversationsUi.title")}
      subtitle={t("conversationsUi.subtitle")}
      toolbar={
        <Toolbar label={t("conversationsUi.list")}>
          <Input
            aria-label={t("conversationsUi.filter")}
            placeholder={t("conversationsUi.filter")}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="h-8 w-56"
          />
          <NativeSelect
            inline
            compact
            aria-label={t("conversationsUi.status")}
            value={status}
            onChange={(e) => setStatus(e.target.value as "" | MessageStatus)}
          >
            <option value="">{t("conversationsUi.any")}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`conversationsUi.statuses.${s}`)}
              </option>
            ))}
          </NativeSelect>
        </Toolbar>
      }
    >
      {shown.length === 0 && (
        <EmptyState
          icon={MessagesSquare}
          title={t("conversationsUi.empty")}
          action={
            <>
              <p className="text-muted-foreground text-xs">{t("conversationsUi.emptyHint")}</p>
              <Button variant="link" onClick={() => props.go({ name: "teams" })}>
                {t("conversationsUi.emptyLink")}
              </Button>
            </>
          }
        />
      )}
      <ul aria-label={t("conversationsUi.list")} className="flex max-w-3xl flex-col gap-2">
        {shown.map((row) => {
          const m = row.message;
          return (
            <li key={m.id} className="flex flex-col gap-1 rounded-lg border bg-card p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <time dateTime={m.createdAt} className="text-muted-foreground tabular-nums">
                  {store.formatDateTime(m.createdAt)}
                </time>
                <span className="font-mono">{`${m.fromHost}/${m.fromSession}`}</span>
                <span className="text-muted-foreground">{t("conversationsUi.to")}</span>
                <span className="font-mono">{`${m.toHost}/${m.toSession}`}</span>
                <Badge variant="outline">{row.hostName}</Badge>
                {m.teamId && <Badge variant="outline">{m.teamId}</Badge>}
                <strong className={TONE[m.status]}>
                  {t(`conversationsUi.statuses.${m.status}`)}
                </strong>
              </div>
              <p className="whitespace-pre-wrap">{m.text}</p>
              {m.reason && <p className="text-status-error text-xs">{m.reason}</p>}
              <Button
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={() => openSession(row)}
              >
                {t("conversationsUi.open")}
              </Button>
            </li>
          );
        })}
      </ul>
    </Page>
  );
});
