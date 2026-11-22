import type { MessageInfo, MessagingSession, SendResult } from "@flightdeck/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { reasonText } from "@/i18n/errors.ts";
import { useStoreSlice } from "@/lib/use-store";
import { ActionButton, InlineNotice } from "@/shared/feedback/index.ts";
import { Field, Inline, NativeSelect, Stack } from "@/shared/layout/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import { RulesLink } from "./rules-link.tsx";
import { inPausedPair } from "./store.ts";

/**
 * Phase 21: a session's messages, sent and received, and a message from it to another session
 * it may see. The daemon applies its rules: what it refuses comes back with the reason.
 */
export function SessionMessages(
  props: Readonly<{ store: AppStore; hostId: string; sessionId: string }>,
) {
  const { store, hostId, sessionId } = props;
  const { t } = store.i18n;
  const { loopAlerts } = useStoreSlice(store, ["loopAlerts"] as const);
  const [messages, setMessages] = useState<MessageInfo[]>([]);
  const [writing, setWriting] = useState(false);
  // Null until the host has answered; the sessions this one may message, which also name the rows.
  const [targets, setTargets] = useState<MessagingSession[] | null>(null);
  const [to, setTo] = useState("");
  const [text, setText] = useState("");
  const [result, setResult] = useState<SendResult | null>(null);
  const toField = useRef<HTMLSelectElement>(null);
  const writeButton = useRef<HTMLButtonElement>(null);
  const textField = useRef<HTMLTextAreaElement>(null);
  // Focus follows the form only after a person opened or closed it, never on the first render.
  const moved = useRef(false);

  const load = useCallback(async () => {
    const list = await store.hostCommand(hostId, "messages.list", { session: sessionId });
    if (list) {
      setMessages([...list.messages].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    }
  }, [store, hostId, sessionId]);
  const loadTargets = useCallback(async () => {
    const found = await store.hostCommand(hostId, "messages.sessions", {
      as: { session: sessionId },
    });
    const list = found?.sessions ?? [];
    setTargets(list);
    return list;
  }, [store, hostId, sessionId]);
  useEffect(() => {
    void load();
    void loadTargets();
    return store.messaging.onUpdated(() => void load());
  }, [store, load, loadTargets]);
  useEffect(() => {
    if (!moved.current) return;
    (writing ? toField : writeButton).current?.focus();
  }, [writing]);

  const openForm = async () => {
    moved.current = true;
    setWriting(true);
    const list = await loadTargets();
    // A choice made while the list was reloading stays, when that session is still on it.
    setTo((chosen) => (list.some((s) => s.address === chosen) ? chosen : (list[0]?.address ?? "")));
  };
  const closeForm = () => {
    moved.current = true;
    setResult(null);
    setWriting(false);
  };
  /** The other side of a message: its name when the list knows it, else its address. */
  const otherSide = (m: MessageInfo) => {
    const sent = m.fromSession === sessionId;
    const address = sent ? `${m.toHost}/${m.toSession}` : `${m.fromHost}/${m.fromSession}`;
    const name = targets?.find((s) => s.address === address)?.name ?? address;
    return t(sent ? "sessionMessages.toName" : "sessionMessages.fromName", { name });
  };
  const send = async () => {
    const sent = await store.hostCommand(hostId, "messages.send", {
      as: { session: sessionId },
      to,
      text,
    });
    if (!sent) return;
    setResult(sent);
    // A refused text stays, so it can be fixed; a sent one is gone, so it cannot go out twice.
    if (sent.status !== "refused") {
      setText("");
      // Send is disabled with the empty box, and the focus it held would fall to the page.
      textField.current?.focus();
    }
  };

  return (
    <Stack gap={3} className="text-sm">
      {writing ? (
        <Stack gap={2} className="rounded-lg border p-3">
          <Field label={t("sessionMessages.to")}>
            {(control) => (
              <NativeSelect
                {...control}
                ref={toField}
                value={to}
                onChange={(e) => {
                  setResult(null);
                  setTo(e.target.value);
                }}
              >
                {(targets ?? []).map((s) => (
                  <option key={s.address} value={s.address}>
                    {s.name ?? s.address}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          {targets?.length === 0 && (
            <p className="text-muted-foreground text-xs">{t("sessionMessages.noTargets")}</p>
          )}
          <Field label={t("sessionMessages.text")}>
            {(control) => (
              <Textarea
                {...control}
                ref={textField}
                value={text}
                onChange={(e) => {
                  setResult(null);
                  setText(e.target.value);
                }}
              />
            )}
          </Field>
          <Inline gap={2}>
            <ActionButton disabled={!to || !text.trim()} onClick={() => send()}>
              {t("sessionMessages.send")}
            </ActionButton>
            <Button variant="ghost" onClick={closeForm}>
              {t("sessionMessages.cancel")}
            </Button>
          </Inline>
          {result && <SendResultNotice store={store} result={result} />}
        </Stack>
      ) : (
        <Button
          ref={writeButton}
          variant="outline"
          className="self-start"
          onClick={() => void openForm()}
        >
          {t("sessionMessages.write")}
        </Button>
      )}
      {messages.length === 0 ? (
        <p className="text-muted-foreground">{t("sessionMessages.empty")}</p>
      ) : (
        <Stack as="ul" label={t("sessionMessages.list")} gap={2}>
          {messages.map((m) => (
            <li key={m.id} className="flex flex-col gap-1 rounded-lg border bg-card p-3">
              <Inline gap={2} className="text-xs">
                <time dateTime={m.createdAt} className="text-muted-foreground tabular-nums">
                  {store.formatDateTime(m.createdAt)}
                </time>
                <Badge variant="outline">
                  {m.fromSession === sessionId
                    ? t("sessionMessages.sent")
                    : t("sessionMessages.received")}
                </Badge>
                <span title={`${m.fromHost}/${m.fromSession} → ${m.toHost}/${m.toSession}`}>
                  {otherSide(m)}
                </span>
                <strong>{t(`conversationsUi.statuses.${m.status}`)}</strong>
              </Inline>
              <p className="whitespace-pre-wrap">{m.text}</p>
              {m.reason && (
                <p className="text-status-error text-xs">
                  {reasonText(t, m.reason, m.reasonKey, m.reasonParams)}
                </p>
              )}
              {inPausedPair(loopAlerts, m) && <RulesLink store={store} />}
            </li>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

/** How a send went: a refusal is announced at once (an alert), a delivered or queued one is a polite status. */
function SendResultNotice(props: Readonly<{ store: AppStore; result: SendResult }>) {
  const { t } = props.store.i18n;
  const { result } = props;
  const status = t(`conversationsUi.statuses.${result.status}`);
  if (result.status !== "refused") {
    return (
      <output aria-label={t("sessionMessages.result")} className="block">
        {status}
      </output>
    );
  }
  const why = result.reason
    ? reasonText(t, result.reason, result.reasonKey, result.reasonParams)
    : "";
  return <InlineNotice tone="error">{why ? `${status} · ${why}` : status}</InlineNotice>;
}
