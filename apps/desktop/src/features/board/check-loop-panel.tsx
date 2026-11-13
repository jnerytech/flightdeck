import type { Card } from "@flightdeck/protocol";
import { useId, useRef, useState } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/i18n/context";
import { refusalText } from "@/i18n/errors";
import type { Key } from "@/i18n/index";
import type { AppStore } from "@/lib/app-store";
import { ConfirmDialog } from "@/shared/feedback/index.ts";
import { Inline, Stack } from "@/shared/layout/index.ts";
import { checkLoopLine } from "./domain/check-loop.ts";

/**
 * Issue #1361: "Keep going until the checks pass" on a card. Turning it on asks the host; outside
 * bypassPermissions the host asks for a confirmation first, which this panel shows with what it
 * means. A line says how the loop goes. A card from a host without the loop shows nothing.
 */
export function CheckLoopPanel(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    card: Card;
    /** What `host.info` says of the app's connection; `false`: far, so the loop cannot be turned on. */
    near?: boolean;
  }>,
) {
  const t = useT();
  const { store, hostId, card } = props;
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const refusedBox = useRef<HTMLDivElement>(null);
  const lineId = useId();
  const farId = useId();
  const switchId = useId();
  const loop = card.checkLoop;
  if (!loop) return null;
  const line = checkLoopLine(loop);
  // Only a near connection may turn the loop on (the host refuses it otherwise); off goes anywhere.
  const locked = props.near === false && !loop.on;
  const described = [line ? lineId : "", locked ? farId : ""].filter(Boolean).join(" ");
  const send = async (on: boolean, confirm?: true) => {
    setRefused(null);
    setBusy(true);
    try {
      const result = await store.hostRequest(hostId, "card.checkLoop", {
        cardId: card.id,
        on,
        ...(confirm ? { confirm } : {}),
      });
      if (result.ok) return;
      if (on && !confirm && result.reason === "check_loop_confirm") {
        setAsking(true);
        return;
      }
      setRefused(refusalText(result.code, result.message, t, result));
      refusedBox.current?.focus();
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="text-sm">
      <Stack gap={2}>
        <Inline gap={2}>
          <Switch
            id={switchId}
            aria-describedby={described || undefined}
            checked={loop.on}
            disabled={busy || locked}
            onCheckedChange={(on) => void send(on)}
          />
          <Label htmlFor={switchId}>{t("checkLoopUi.switch")}</Label>
        </Inline>
        {line && (
          <p id={lineId} className="text-muted-foreground text-xs">
            {t(line.key as Key, line.params)}
          </p>
        )}
        {locked && (
          <p id={farId} className="text-muted-foreground text-xs">
            {t("checkLoopUi.farOff")}
          </p>
        )}
        <div
          role="alert"
          ref={refusedBox}
          tabIndex={-1}
          className="rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
        >
          {refused && <p>{refused}</p>}
        </div>
      </Stack>
      {asking && (
        <ConfirmDialog
          message={t("checkLoopUi.confirm")}
          confirmLabel={t("checkLoopUi.confirmAction")}
          onConfirm={() => {
            setAsking(false);
            void send(true, true);
          }}
          onCancel={() => setAsking(false)}
        />
      )}
    </section>
  );
}
