import { memo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";
import { useStoreSlice } from "@/lib/use-store";
import { ActionButton, ConfirmDialog } from "@/shared/feedback/index.ts";
import { Field, Form, Inline, Panel, Stack } from "@/shared/layout/index.ts";
import { basename } from "@/shared/lib/index.ts";
import type { Key } from "../../i18n/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import { hasFeature } from "../../lib/version.ts";
import { usd } from "../costs/index.ts";

const BGPANEL_KEYS = ["background", "hosts"] as const;

/** The states the dictionary names; a newer host may report others, which the panel shows as they are. */
const KNOWN_STATES = new Set(["working", "blocked", "done", "failed", "stopped"]);
/** A session in one of these is over: there is nothing to stop. */
const OVER = new Set(["done", "failed", "stopped"]);

/**
 * What can be done to a Claude Code background session (`claude --bg`): its state and what it
 * waits for, stop (after a question) and restart through `claude`, bring it to a terminal tab, and a
 * message. Nothing when the session is not in the host's `claude agents` listing.
 */
export const BgPanel = memo(function BgPanel(props: {
  store: AppStore;
  hostId: string;
  claudeSessionId: string;
}) {
  const t = useT();
  const { store, hostId } = props;
  const state = useStoreSlice(store, BGPANEL_KEYS);
  const session = state.background[hostId]?.sessions.find(
    (s) => s.claudeSessionId === props.claudeSessionId,
  );
  const [text, setText] = useState("");
  const [acting, setActing] = useState<"stop" | "respawn" | null>(null);
  const [failed, setFailed] = useState<"stop" | "respawn" | null>(null);
  const [asking, setAsking] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<"ok" | "refused" | null>(null);
  const field = useRef<HTMLInputElement>(null);
  // A ref too: two submits in the same event see the first one before React renders it.
  const inFlight = useRef(false);
  const region = useRef<HTMLElement>(null);
  if (!session) return null;
  const name = session.name || basename(session.cwd);
  const act = async (kind: "stop" | "respawn") => {
    setFailed(null);
    setActing(kind);
    const done = await store.background.act(hostId, kind, session.id);
    setActing(null);
    if (!done) setFailed(kind);
  };
  const host = state.hosts.find((h) => h.id === hostId);
  const terminal = hasFeature(host?.hostInfo?.features, "terminal", false);
  const send = async () => {
    if (!text.trim() || inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setSent(null);
    let accepted = false;
    try {
      accepted = await store.background.message(hostId, session.id, text.trim());
    } finally {
      inFlight.current = false;
      setSending(false);
    }
    setSent(accepted ? "ok" : "refused");
    if (accepted) setText("");
    // The button is off again once the box is empty: the focus stays where the person types.
    field.current?.focus();
  };
  return (
    <section ref={region} tabIndex={-1} aria-label={t("bg.region", { name })}>
      <Panel size="sm">
        <Stack gap={2}>
          <output className="text-sm">
            {[
              KNOWN_STATES.has(session.state)
                ? t(`bg.state.${session.state}` as Key)
                : t("bg.stateUnknown", { state: session.state }),
              session.waitingFor ? t("bg.waitingFor", { what: session.waitingFor }) : null,
              session.costUsd === null
                ? null
                : t("bg.cost", { cost: usd(session.costUsd, t.lang) }),
            ]
              .filter((part) => part !== null)
              .join(" · ")}
          </output>
          <Inline>
            <ActionButton
              variant="outline"
              size="sm"
              pending={acting === "stop"}
              disabled={OVER.has(session.state)}
              disabledReason={t("bg.stopOff")}
              onClick={() => setAsking(true)}
            >
              {t("bg.stop")}
            </ActionButton>
            <ActionButton
              variant="outline"
              size="sm"
              pending={acting === "respawn"}
              disabled={session.state === "working"}
              disabledReason={t("bg.respawnOff")}
              onClick={() => act("respawn")}
            >
              {t("bg.respawn")}
            </ActionButton>
            {terminal && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void store.background.attach(hostId, session)}
              >
                {t("bg.attach")}
              </Button>
            )}
          </Inline>
          <output className="text-destructive text-sm empty:sr-only">
            {failed ? t(failed === "stop" ? "bg.stopFailed" : "bg.respawnFailed") : ""}
          </output>
          <Form variant="inline" onSubmit={() => void send()}>
            <Inline>
              <Field label={t("bg.message")}>
                {(control) => (
                  <Input
                    {...control}
                    ref={field}
                    value={text}
                    onChange={(e) => {
                      setText(e.target.value);
                      setSent(null);
                    }}
                  />
                )}
              </Field>
              <ActionButton
                type="submit"
                variant="outline"
                size="sm"
                pending={sending}
                disabled={!text.trim()}
              >
                {t("bg.send")}
              </ActionButton>
            </Inline>
            <output
              className={`text-sm empty:sr-only ${sent === "refused" ? "text-destructive" : ""}`}
            >
              {sent === "ok" ? t("bg.sent") : sent === "refused" ? t("bg.sendFailed") : ""}
            </output>
          </Form>
        </Stack>
      </Panel>
      {asking && (
        <ConfirmDialog
          message={t("bg.stopConfirm", { name })}
          confirmLabel={t("bg.stopTitle")}
          destructive
          // Stop turns its own button off: the focus goes to the panel, not to a disabled control.
          onRestoreFocus={() => region.current?.focus()}
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            void act("stop");
          }}
        />
      )}
    </section>
  );
});
