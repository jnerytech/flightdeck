import type { HistoryMessage } from "@flightdeck/protocol";
import { useEffect, useState } from "react";
import type { AppStore } from "../../lib/app-store.ts";
import { HISTORY_PAGE } from "../../lib/app-store.ts";
import { Markdown } from "../../ui/Markdown.tsx";
import { Note } from "../layout/note.tsx";
import { Message } from "./parts.tsx";

/** The most earlier turns shown; the transcript reader in History has all of them. */
const MAX_TURNS = HISTORY_PAGE * 4;

type Loaded =
  | { state: "loading" }
  | { state: "ok"; messages: HistoryMessage[]; more: boolean }
  | { state: "failed"; reason: string };

/**
 * The turns a session resumed from History already had, read from the host's transcript and put
 * above the new ones. A transcript that cannot be read says why: the pane is never left blank.
 */
export function EarlierTurns(props: { store: AppStore; hostId: string; claudeSessionId: string }) {
  const { store, hostId, claudeSessionId } = props;
  const { t } = store.i18n;
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  useEffect(() => {
    let alive = true;
    void (async () => {
      const messages: HistoryMessage[] = [];
      let cursor: string | undefined;
      let more = false;
      while (true) {
        const answer = await store.hostRequest(hostId, "history.get", {
          claudeSessionId,
          limit: HISTORY_PAGE,
          ...(cursor ? { cursor } : {}),
        });
        if (!alive) return;
        if (!answer.ok) return setLoaded({ state: "failed", reason: answer.message });
        messages.push(...answer.data.messages.filter((m) => m.kind === "message"));
        cursor = answer.data.nextCursor ?? undefined;
        if (!cursor) break;
        if (messages.length >= MAX_TURNS) {
          more = true;
          break;
        }
      }
      setLoaded({ state: "ok", messages: messages.slice(0, MAX_TURNS), more });
    })();
    return () => {
      alive = false;
    };
  }, [store, hostId, claudeSessionId]);

  if (loaded.state === "loading") return null;
  return (
    <section aria-label={t("session.earlier.title")} className="flex flex-col gap-3">
      {loaded.state === "failed" && (
        <Note>{t("session.earlier.unreadable", { reason: loaded.reason })}</Note>
      )}
      {loaded.state === "ok" && loaded.messages.length === 0 && (
        <Note>{t("session.earlier.empty")}</Note>
      )}
      {loaded.state === "ok" &&
        loaded.messages.map((m) => (
          <Message key={m.uuid} from={m.role === "user" ? "user" : "assistant"}>
            {m.role === "assistant" ? <Markdown text={m.text} /> : m.text}
          </Message>
        ))}
      {loaded.state === "ok" && loaded.more && (
        <Note>{t("session.earlier.truncated", { count: MAX_TURNS })}</Note>
      )}
    </section>
  );
}
