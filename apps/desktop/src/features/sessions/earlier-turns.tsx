import type { HistoryMessage } from "@flightdeck/protocol";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Note } from "@/shared/layout/index.ts";
import { Markdown } from "@/shared/markdown/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import { HISTORY_PAGE } from "../../lib/app-store.ts";
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
export function EarlierTurns(
  props: Readonly<{ store: AppStore; hostId: string; claudeSessionId: string }>,
) {
  const { store, hostId, claudeSessionId } = props;
  const { t } = store.i18n;
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  // Try again was pressed and the read is running again: the failure's block stays, so the focus does.
  const [retrying, setRetrying] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is what Try again changes, to read again
  useEffect(() => {
    let alive = true;
    void (async () => {
      const messages: HistoryMessage[] = [];
      let cursor: string | undefined;
      let more = false;
      while (true) {
        const answer =
          await /* NOSONAR: paging: each page is asked for with the cursor of the one before */ store.hostRequest(
            hostId,
            "history.get",
            {
              claudeSessionId,
              limit: HISTORY_PAGE,
              ...(cursor ? { cursor } : {}),
            },
          );
        if (!alive) return;
        if (!answer.ok) {
          setRetrying(false);
          return setLoaded({ state: "failed", reason: answer.message });
        }
        messages.push(...answer.data.messages.filter((m) => m.kind === "message"));
        cursor = answer.data.nextCursor ?? undefined;
        if (!cursor) break;
        if (messages.length >= MAX_TURNS) {
          more = true;
          break;
        }
      }
      setRetrying(false);
      setLoaded({ state: "ok", messages: messages.slice(0, MAX_TURNS), more });
    })();
    return () => {
      alive = false;
    };
  }, [store, hostId, claudeSessionId, attempt]);

  return (
    <section aria-label={t("session.earlier.title")} className="flex flex-col gap-3">
      {loaded.state === "loading" && (
        <Note>
          <output>{t("session.earlier.loading")}</output>
        </Note>
      )}
      {loaded.state === "failed" && (
        <Note>
          {retrying ? (
            <output>{t("session.earlier.loading")}</output>
          ) : (
            <p role="alert">{t("session.earlier.unreadable", { reason: loaded.reason })}</p>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-disabled={retrying}
            className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
            onClick={() => {
              if (retrying) return;
              setRetrying(true);
              setAttempt((n) => n + 1);
            }}
          >
            {t("session.earlier.retry")}
          </Button>
        </Note>
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
