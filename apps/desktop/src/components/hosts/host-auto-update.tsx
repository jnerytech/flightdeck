import type { AutoUpdateStatus } from "@flightdeck/protocol";
import { useState } from "react";
import { Stack } from "@/components/layout/stack";
import type { AppStore, HostView } from "@/lib/app-store";
import { hasFeature } from "@/lib/version";

/**
 * Issue #280: the host's automatic update, on the host page. The switch is the daemon's own
 * setting (`host.updates.set`); the line under it says what the daemon is doing about it.
 */
export function HostAutoUpdate(props: Readonly<{ store: AppStore; host: HostView }>) {
  const t = props.store.i18n.t;
  const { store, host } = props;
  const reported = host.hostInfo?.autoUpdate;
  const [answered, setAnswered] = useState<AutoUpdateStatus | null>(null);
  const [sending, setSending] = useState(false);
  if (!hasFeature(host.hostInfo?.features, "autoUpdate", false) || !reported) return null;
  const status = answered ?? reported;
  const version = status.version ?? "";
  const line =
    status.state === "waiting"
      ? t("hostAutoUpdate.waiting", { version })
      : status.state === "started"
        ? t("hostAutoUpdate.started", { version })
        : status.state === "failed"
          ? t("hostAutoUpdate.failed", { version, reason: status.reason ?? "" })
          : t(status.enabled ? "hostAutoUpdate.current" : "hostAutoUpdate.off");
  return (
    <Stack gap={1}>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={status.enabled}
          disabled={sending}
          onChange={async (e) => {
            setSending(true);
            const next = await store.hostCommand(host.id, "host.updates.set", {
              auto: e.target.checked,
            });
            setSending(false);
            if (next) setAnswered(next);
          }}
        />
        {t("hostAutoUpdate.label")}
      </label>
      <p className="text-muted-foreground text-sm">{line}</p>
    </Stack>
  );
}
