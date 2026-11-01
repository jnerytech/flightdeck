import type { MessageInfo, MessagingSession, SendResult } from "@flightdeck/protocol";
import { useCallback, useEffect, useState } from "react";
import { Field, NativeSelect } from "@/components/layout/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { AppStore } from "../lib/app-store.ts";

/**
 * Phase 21: a session's messages, sent and received, and a message from it to another session
 * it may see. The daemon applies its rules: what it refuses comes back with the reason.
 */
export function SessionMessages(props: { store: AppStore; hostId: string; sessionId: string }) {
  const { store, hostId, sessionId } = props;
  const { t } = store.i18n;
  const [messages, setMessages] = useState<MessageInfo[]>([]);
  const [writing, setWriting] = useState(false);
  const [targets, setTargets] = useState<MessagingSession[]>([]);
  const [to, setTo] = useState("");
  const [text, setText] = useState("");
  const [result, setResult] = useState<SendResult | null>(null);

  const load = useCallback(async () => {
    const list = await store.hostCommand(hostId, "messages.list", { session: sessionId });
    if (list) {
      setMessages([...list.messages].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    }
  }, [store, hostId, sessionId]);
  useEffect(() => {
    void load();
    return store.onMessageUpdated(() => void load());
  }, [store, load]);

  const openForm = async () => {
    setWriting(true);
    const found = await store.hostCommand(hostId, "messages.sessions", {
      as: { session: sessionId },
    });
    const list = found?.sessions ?? [];
    setTargets(list);
    setTo(list[0]?.address ?? "");
  };
  const send = async () => {
    const sent = await store.hostCommand(hostId, "messages.send", {
      as: { session: sessionId },
      to,
      text,
    });
    if (sent) setResult(sent);
  };

  return (
    <section className="flex flex-col gap-3 text-sm">
      {writing ? (
        <div className="flex flex-col gap-2 rounded-lg border p-3">
          <Field label={t("sessionMessages.to")}>
            {(control) => (
              <NativeSelect {...control} value={to} onChange={(e) => setTo(e.target.value)}>
                {targets.map((s) => (
                  <option key={s.address} value={s.address}>
                    {s.name ?? s.address}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label={t("sessionMessages.text")}>
            {(control) => (
              <Textarea {...control} value={text} onChange={(e) => setText(e.target.value)} />
            )}
          </Field>
          <div className="flex gap-2">
            <Button disabled={!to || !text.trim()} onClick={() => void send()}>
              {t("sessionMessages.send")}
            </Button>
            <Button variant="ghost" onClick={() => setWriting(false)}>
              {t("sessionMessages.cancel")}
            </Button>
          </div>
          {result && (
            <p role="status" aria-label={t("sessionMessages.result")}>
              {t(`conversationsUi.statuses.${result.status}`)}
              {result.reason ? ` · ${result.reason}` : ""}
            </p>
          )}
        </div>
      ) : (
        <Button variant="outline" className="self-start" onClick={() => void openForm()}>
          {t("sessionMessages.write")}
        </Button>
      )}
      {messages.length === 0 ? (
        <p className="text-muted-foreground">{t("sessionMessages.empty")}</p>
      ) : (
        <ul aria-label={t("sessionMessages.list")} className="flex flex-col gap-2">
          {messages.map((m) => (
            <li key={m.id} className="flex flex-col gap-1 rounded-lg border bg-card p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <time dateTime={m.createdAt} className="text-muted-foreground tabular-nums">
                  {store.formatDateTime(m.createdAt)}
                </time>
                <Badge variant="outline">
                  {m.fromSession === sessionId
                    ? t("sessionMessages.sent")
                    : t("sessionMessages.received")}
                </Badge>
                <span className="font-mono">{`${m.fromHost}/${m.fromSession} → ${m.toHost}/${m.toSession}`}</span>
                <strong>{t(`conversationsUi.statuses.${m.status}`)}</strong>
              </div>
              <p className="whitespace-pre-wrap">{m.text}</p>
              {m.reason && <p className="text-status-error text-xs">{m.reason}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
