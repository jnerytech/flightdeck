import { memo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";
import { useStoreSlice } from "@/lib/use-store";
import { Field, Inline, Panel, Stack } from "@/shared/layout/index.ts";
import type { Key } from "../../i18n/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import { usd } from "../../lib/costs.ts";
import { hasFeature } from "../../lib/version.ts";

const BGPANEL_KEYS = ["background", "hosts"] as const;

/**
 * What can be done to a Claude Code background session (`claude --bg`): its state and what it
 * waits for, stop and restart through `claude`, bring it to a terminal tab, and a message. Nothing
 * when the session is not in the host's `claude agents` listing.
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
  if (!session) return null;
  const host = state.hosts.find((h) => h.id === hostId);
  const terminal = hasFeature(host?.hostInfo?.features, "terminal", false);
  const send = async () => {
    if (!text.trim()) return;
    if (await store.background.message(hostId, session.id, text.trim())) setText("");
  };
  return (
    <section aria-label={t("bg.region")}>
      <Panel size="sm">
        <Stack gap={2}>
          <p className="text-sm">
            {[
              t(`bg.state.${session.state}` as Key),
              session.waitingFor ? t("bg.waitingFor", { what: session.waitingFor }) : null,
              session.costUsd === null
                ? null
                : t("bg.cost", { cost: usd(session.costUsd, t.lang) }),
            ]
              .filter((part) => part !== null)
              .join(" · ")}
          </p>
          <Inline>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void store.background.act(hostId, "stop", session.id)}
            >
              {t("bg.stop")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void store.background.act(hostId, "respawn", session.id)}
            >
              {t("bg.respawn")}
            </Button>
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
});
