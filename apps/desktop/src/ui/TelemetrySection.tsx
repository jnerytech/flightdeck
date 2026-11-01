import type { TelemetryOptInStatus } from "@flightdeck/protocol";
import { useEffect, useState } from "react";
import { Panel } from "@/components/layout/panel";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import { Inline, Stack } from "../components/layout/stack.tsx";
import type { Key } from "../i18n/index.ts";
import type { AppStore } from "../lib/app-store.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

const LABELS: Record<TelemetryOptInStatus["status"], Key> = {
  installed: "telemetry.optinInstalled",
  absent: "telemetry.optinAbsent",
  outdated: "telemetry.optinOutdated",
  conflict: "telemetry.optinAbsent",
};

/**
 * The host page's row for the telemetry of a plain `claude`: whether Flightdeck's exporter keys
 * are in the user's settings.json, and the install and remove that edit it, each after a
 * confirmation that names the file.
 */
export function TelemetrySection(props: { store: AppStore; hostId: string }) {
  const t = useT();
  const { store, hostId } = props;
  const [info, setInfo] = useState<TelemetryOptInStatus | null>(null);
  const [confirming, setConfirming] = useState<"install" | "uninstall" | null>(null);

  useEffect(() => {
    void store.hostCommand(hostId, "telemetry.status", {}).then(setInfo);
  }, [store, hostId]);

  const apply = async () => {
    const kind = confirming;
    setConfirming(null);
    const result = await store.hostCommand(
      hostId,
      kind === "install" ? "telemetry.install" : "telemetry.uninstall",
      { confirm: true },
    );
    // A refusal went to the notices; the panel asks again so it shows what is really there.
    setInfo(result ?? (await store.hostCommand(hostId, "telemetry.status", {})));
  };

  const path = info?.settingsPath ?? "~/.claude/settings.json";
  return (
    <section aria-label={t("telemetry.optinTitle")}>
      <Panel title={t("telemetry.optinTitle")}>
        <Stack gap={2}>
          <p className="text-muted-foreground text-xs">{t("telemetry.optinHint")}</p>
          <p className="text-sm">{info ? t(LABELS[info.status]) : t("telemetry.optinAsking")}</p>
          {info && info.conflicts.length > 0 && (
            <p className="text-sm">
              {t("telemetry.optinConflict", { keys: info.conflicts.join(", ") })}
            </p>
          )}
          <Inline>
            <Button variant="outline" size="sm" onClick={() => setConfirming("install")}>
              {t("telemetry.optinInstall")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setConfirming("uninstall")}>
              {t("telemetry.optinUninstall")}
            </Button>
          </Inline>
        </Stack>
      </Panel>
      {confirming && (
        <ConfirmDialog
          message={t(
            confirming === "install"
              ? "telemetry.optinInstallMessage"
              : "telemetry.optinUninstallMessage",
            { path },
          )}
          confirmLabel={t(
            confirming === "install" ? "telemetry.optinInstall" : "telemetry.optinUninstall",
          )}
          destructive={confirming === "uninstall"}
          onConfirm={() => void apply()}
          onCancel={() => setConfirming(null)}
        />
      )}
    </section>
  );
}
