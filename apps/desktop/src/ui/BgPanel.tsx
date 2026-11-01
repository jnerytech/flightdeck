import { useState } from "react";
import { Field } from "@/components/layout/form";
import { Panel } from "@/components/layout/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";
import { Inline, Stack } from "../components/layout/stack.tsx";
import type { Key } from "../i18n/index.ts";
import type { AppState, AppStore } from "../lib/app-store.ts";
import { usd } from "../lib/costs.ts";
import { hasFeature } from "../lib/version.ts";

/**
 * What can be done to a Claude Code background session (`claude --bg`): its state and what it
 * waits for, stop and restart through `claude`, bring it to a terminal tab, and a message. Nothing
 * when the session is not in the host's `claude agents` listing.
 */
export function BgPanel(props: {
  store: AppStore;
  state: AppState;
  hostId: string;
  claudeSessionId: string;
}) {
  const t = useT();
  const { store, state, hostId } = props;
  const session = state.background[hostId]?.sessions.find(
    (s) => s.claudeSessionId === props.claudeSessionId,
  );
  const [text, setText] = useState("");
  if (!session) return null;
  const host = state.hosts.find((h) => h.id === hostId);
  const terminal = hasFeature(host?.hostInfo?.features, "terminal", false);
  const send = async () => {
    if (!text.trim()) return;
    if (await store.bgMessage(hostId, session.id, text.trim())) setText("");
  };
  return (
    <section aria-label={t("bg.region")}>
      <Panel size="sm">
        <Stack gap={2}>
          <p className="text-sm">
            {[
              t(`bg.state.${session.state}` as Key),
              session.waitingFor ? t("bg.waitingFor", { what: session.waitingFor }) : null,
              session.costUsd === null ? null : t("bg.cost", { cost: usd(session.costUsd) }),
            ]
              .filter((part) => part !== null)
              .join(" · ")}
          </p>
          <Inline>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void store.bgAction(hostId, "stop", session.id)}
            >
              {t("bg.stop")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void store.bgAction(hostId, "respawn", session.id)}
            >
              {t("bg.respawn")}
            </Button>
            {terminal && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void store.bgAttach(hostId, session)}
              >
                {t("bg.attach")}
              </Button>
            )}
          </Inline>
          <Inline>
            <Field label={t("bg.message")}>
              {(control) => (
                <Input {...control} value={text} onChange={(e) => setText(e.target.value)} />
              )}
            </Field>
            <Button variant="outline" size="sm" onClick={() => void send()}>
              {t("bg.send")}
            </Button>
          </Inline>
        </Stack>
      </Panel>
    </section>
  );
}
