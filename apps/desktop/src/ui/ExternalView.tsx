import { Radio } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApprovalCard } from "@/components/approval/approval-card";
import { AssistField } from "@/components/assistant/assist-field";
import { PersonaSwitch } from "@/components/personas/persona-switch";
import { Composer, RecapSlot, SessionHeader, SessionPane } from "@/components/session/parts";
import { PromptMenu, type PromptSnippets } from "@/components/snippets/prompt-menu";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { type AppState, type AppStore, sessionKey } from "../lib/app-store.ts";
import { basename } from "../lib/paths.ts";
import { useLaunchTerminal } from "../lib/use-launch-terminal.ts";
import { hasFeature } from "../lib/version.ts";
import { BgPanel } from "./BgPanel.tsx";
import { CheckpointsButton } from "./Checkpoints.tsx";
import { RecapPanel } from "./RecapPanel.tsx";
import { TerminalButton } from "./TerminalButton.tsx";
import { TranscriptReader } from "./TranscriptReader.tsx";

/** The dictionary key of a terminal session's state. */
const STATE_KEYS = {
  running: "running",
  awaiting_permission: "needs_you",
  idle: "idle",
  unknown: "idle",
  ended: "ended",
} as const;

/**
 * A live session opened outside Flightdeck: its transcript as it grows, its permission requests
 * inline, and a message box when it runs under `flightdeckd claude` (controllable).
 */
export function ExternalView(
  props: Readonly<{
    store: AppStore;
    state: AppState;
    hostId: string;
    hostName: string;
    claudeSessionId: string;
    onResumed(): void;
    /** Phase 18: the prompt snippets `/` offers in the message box. */
    prompts?: PromptSnippets;
  }>,
) {
  const t = props.store.i18n.t;
  const { store, state, hostId, claudeSessionId: id } = props;
  const key = sessionKey(hostId, id);
  const session = state.externals[key];
  // Never the raw id: a session just opened has no name and no folder until its first events.
  const title =
    state.meta[key]?.name ?? (session?.cwd ? basename(session.cwd) : t("external.untitled"));
  const requests = Object.entries(state.externalRequests)
    .filter(([k, request]) => k.startsWith(`${hostId}/`) && request.claudeSessionId === id)
    .map(([, request]) => request);
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const terminalId = useLaunchTerminal(store, hostId, session?.launchId ?? null);
  const host = state.hosts.find((h) => h.id === hostId);
  const alwaysAllow = hasFeature(host?.hostInfo?.features, "rules", false);
  const withCheckpoints = hasFeature(host?.hostInfo?.features, "checkpoints", false);
  // Stable, or the reader would reload on every render.
  const target = useMemo(() => ({ hostId, claudeSessionId: id }), [hostId, id]);

  const send = () => {
    if (!text.trim()) return;
    void store.hostCommand(hostId, "external.message", { claudeSessionId: id, text: text.trim() });
    setText("");
  };

  return (
    <SessionPane>
      <SessionHeader
        title={title}
        subtitle={t("external.line", {
          host: props.hostName,
          state: t(`hub.stateDots.${STATE_KEYS[session?.status ?? "unknown"]}`),
        })}
        controls={
          <>
            {session?.permissionMode && (
              <span className="text-muted-foreground text-xs">
                {t("session.modeChip", { mode: t(`modes.${session.permissionMode}.name`) })}
              </span>
            )}
            {session?.controllable && (
              <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
                <Radio aria-hidden="true" className="size-3" />
                {t("external.controllable")}
              </span>
            )}
            {withCheckpoints && session?.cwd && (
              <CheckpointsButton
                store={store}
                hostId={hostId}
                claudeSessionId={id}
                cwd={session.cwd}
                busy={session.status === "running" || session.status === "awaiting_permission"}
              />
            )}
            {terminalId && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => store.hostTabs.show({ name: "terminal", host: hostId, terminalId })}
              >
                {t("claudeHere.viewTerminal")}
              </Button>
            )}
            {session?.controllable && hasFeature(host?.hostInfo?.features, "personas", false) && (
              <PersonaSwitch
                store={store}
                hostId={hostId}
                target={{ claudeSessionId: id }}
                current={null}
              />
            )}
            {session?.cwd && (
              <TerminalButton
                store={store}
                hostId={hostId}
                target={{ cwd: session.cwd, claudeSessionId: id }}
              />
            )}
          </>
        }
      />
      <BgPanel store={store} hostId={hostId} claudeSessionId={id} />
      <RecapSlot>
        <RecapPanel
          store={store}
          hostId={hostId}
          claudeSessionId={id}
          {...(session?.lastEventAt ? { stamp: session.lastEventAt } : {})}
        />
      </RecapSlot>
      {requests.length > 0 && (
        <div className="flex flex-col gap-3 border-b p-3">
          {requests.map((request) => (
            <ApprovalCard
              key={request.requestId}
              request={{
                requestId: request.requestId,
                toolName: request.toolName,
                input: request.input,
                cwd: session?.cwd ?? null,
                createdAt: request.createdAt,
                ...(request.suggestions ? { suggestions: request.suggestions } : {}),
                ...(request.risk ? { risk: request.risk } : {}),
                ...(request.riskReason ? { riskReason: request.riskReason } : {}),
              }}
              t={store.i18n.t}
              nowMs={store.now()}
              onCopyPath={(path) => void store.copyText(path)}
              alwaysAllow={alwaysAllow}
              onRespond={(decision, message, updates, updatedInput, held) =>
                store.respondTo(hostId, request.requestId, decision, {
                  updatedPermissions: updates,
                  message,
                  updatedInput,
                  held,
                })
              }
            />
          ))}
        </div>
      )}
      {session?.controllable && (
        <div className="relative">
          <PromptMenu
            prompts={props.prompts}
            text={text}
            label={t("session.snippets")}
            onFill={setText}
            input={box}
          />
          {/* The AI wand (phase 40): it improves the message and never sends it. */}
          <AssistField
            binding={{
              controller: store.assistant,
              kind: "prompt",
              fieldHostId: hostId,
              ...(session.cwd ? { cwd: session.cwd } : {}),
              openSettings: () => store.router.push({ name: "settings", section: "assistant" }),
            }}
            value={text}
            onChange={setText}
            t={t}
          >
            {(assist) => (
              <Composer>
                <Textarea
                  ref={box}
                  {...assist}
                  aria-label={t("external.message")}
                  placeholder={t("external.placeholder")}
                  value={text}
                  className="max-h-40 min-h-9 flex-1 resize-none"
                  rows={1}
                  onChange={(e) => setText(e.target.value)}
                />
                <Button onClick={send}>{t("external.send")}</Button>
              </Composer>
            )}
          </AssistField>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <TranscriptReader
          key={id}
          store={store}
          target={target}
          hostName={props.hostName}
          onResumed={props.onResumed}
        />
      </div>
    </SessionPane>
  );
}
