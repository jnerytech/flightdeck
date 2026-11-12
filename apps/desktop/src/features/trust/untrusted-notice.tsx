import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useTight } from "@/features/sessions/parts.tsx";
import type { AppStore } from "@/lib/app-store";
import { InlineNotice } from "@/shared/feedback/index.ts";

/**
 * A session in a folder the person has not trusted says what did not load: the folder's own hooks,
 * MCP servers, settings, CLAUDE.md, agents and skills, and also the person's own MCP servers and
 * plugins (issue #196). A trusted folder gets a one-line mark saying so (#1704); nothing when the
 * host does not announce trust.
 */
export function UntrustedNotice(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    /** The host announces projectTrust. */
    announced: boolean;
    cwd: string;
    /** Opens the project's page, where the person can read what it would load and trust it. */
    onReview?: () => void;
    /** Issue #463: the session loaded the project's setup and its trust was revoked since. */
    stale?: boolean;
    /** The session, for restarting it. */
    sessionId?: string;
  }>,
) {
  const { store, hostId, announced, cwd, stale, sessionId } = props;
  const { t } = store.i18n;
  // What the host said about the folder; null until it answered (or when it did not).
  const [trusted, setTrusted] = useState<boolean | null>(null);
  const [restarting, setRestarting] = useState(false);
  // Issue #422: in a short session area the notice is one line; the project page lists the rest. So
  // while a request waits for the person (#488).
  const short = useTight();
  useEffect(() => {
    // No folder yet (the session page before its summary): nothing to ask, and the host refuses "".
    if (!announced || stale || !cwd) return;
    let current = true;
    void store.hostCommand(hostId, "project.trust.state", { paths: [cwd] }).then((answer) => {
      if (current) setTrusted(answer?.items[0]?.trusted ?? null);
    });
    return () => {
      current = false;
    };
  }, [store, hostId, announced, cwd, stale]);
  // Issue #463: the session loaded the setup before the trust was revoked; it keeps it until it is restarted.
  if (stale && announced) {
    const restart = async (id: string) => {
      setRestarting(true);
      try {
        await store.hostCommand(hostId, "session.close", { sessionId: id });
        await store.hostCommand(hostId, "session.resume", { sessionId: id });
      } finally {
        setRestarting(false);
      }
    };
    return (
      <InlineNotice tone="warn">
        {t("projectPage.trust.revokedNotice")}{" "}
        {sessionId && (
          <Button
            variant="link"
            size="sm"
            className="h-auto px-0 py-0"
            disabled={restarting}
            onClick={() => restart(sessionId).catch(() => undefined)}
          >
            {t("projectPage.trust.restart")}
          </Button>
        )}
      </InlineNotice>
    );
  }
  if (trusted === null) return null;
  // The mark is for a tall area: a short one keeps its room for the conversation (#422, #1704).
  if (trusted) {
    return short ? null : (
      <InlineNotice tone="info">{t("projectPage.trust.sessionTrusted")}</InlineNotice>
    );
  }
  return (
    <InlineNotice>
      {t(short ? "projectPage.trust.sessionNoticeShort" : "projectPage.trust.sessionNotice")}{" "}
      {props.onReview && (
        <Button variant="link" size="sm" className="h-auto px-0 py-0" onClick={props.onReview}>
          {t("projectPage.trust.review")}
        </Button>
      )}
    </InlineNotice>
  );
}
