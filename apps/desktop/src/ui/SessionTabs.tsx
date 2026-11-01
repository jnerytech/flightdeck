import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import type { AppStore } from "../lib/app-store.ts";
import { ChangesPanel } from "./ChangesPanel.tsx";
import { SessionFiles } from "./SessionFiles.tsx";
import { SessionMessages } from "./SessionMessages.tsx";
import { TempoPanel } from "./TempoPanel.tsx";

/**
 * A session's screen with the Mudanças tab beside its conversation (phase 11). Without the tab
 * (a host that does not announce the review, or a session Claude Code has not named yet) the
 * conversation is all there is. The conversation stays mounted under the other tab, so what was
 * typed in its box is still there.
 */
export function SessionTabs(props: {
  store: AppStore;
  hostId: string;
  /** The Claude Code session id, once known. */
  claudeSessionId: string | null | undefined;
  /** The host announces `review`. */
  enabled: boolean;
  /** Phase 21: the session's id for messages, when the host announces `messaging`. */
  messagingId?: string | null | undefined;
  /** Phase 23: the host announces `telemetry`, so the Tempo tab has a timeline to show. */
  telemetry?: boolean;
  children: ReactNode;
}) {
  const t = useT();
  const [tab, setTab] = useState<"conversation" | "changes" | "messages" | "time">("conversation");
  const changes = props.enabled && !!props.claudeSessionId;
  const time = !!props.telemetry && !!props.claudeSessionId;
  if (!changes && !props.messagingId && !time) return props.children;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex gap-2 border-b px-4 py-2">
        <Button
          variant="outline"
          size="sm"
          aria-pressed={tab === "conversation"}
          className="aria-pressed:bg-accent"
          onClick={() => setTab("conversation")}
        >
          {t("changes.conversationTab")}
        </Button>
        {changes && (
          <Button
            variant="outline"
            size="sm"
            aria-pressed={tab === "changes"}
            className="aria-pressed:bg-accent"
            onClick={() => setTab("changes")}
          >
            {t("changes.tab")}
          </Button>
        )}
        {time && (
          <Button
            variant="outline"
            size="sm"
            aria-pressed={tab === "time"}
            className="aria-pressed:bg-accent"
            onClick={() => setTab("time")}
          >
            {t("telemetry.tab")}
          </Button>
        )}
        {props.messagingId && (
          <Button
            variant="outline"
            size="sm"
            aria-pressed={tab === "messages"}
            className="aria-pressed:bg-accent"
            onClick={() => setTab("messages")}
          >
            {t("sessionMessages.tab")}
          </Button>
        )}
      </div>
      <div hidden={tab !== "conversation"} className="min-h-0 flex-1">
        {props.children}
      </div>
      {(tab === "messages" || tab === "time") && (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {tab === "messages" && props.messagingId && (
            <SessionMessages
              store={props.store}
              hostId={props.hostId}
              sessionId={props.messagingId}
            />
          )}
          {tab === "time" && props.claudeSessionId && (
            <TempoPanel
              store={props.store}
              hostId={props.hostId}
              claudeSessionId={props.claudeSessionId}
            />
          )}
        </div>
      )}
      {tab === "changes" && props.claudeSessionId && (
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
          <ChangesPanel
            store={props.store}
            hostId={props.hostId}
            target={`session:${props.claudeSessionId}`}
          />
          <SessionFiles
            store={props.store}
            hostId={props.hostId}
            claudeSessionId={props.claudeSessionId}
          />
        </div>
      )}
    </div>
  );
}
