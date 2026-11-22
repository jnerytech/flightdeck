import type { TelemetryOptInStatus } from "@flightdeck/protocol";
import { useCallback, useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import { ConfirmDialog } from "@/shared/feedback/index.ts";
import { ErrorState, Inline, Panel, Stack } from "@/shared/layout/index.ts";
import type { Key } from "../../i18n/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import { optinActions } from "./domain/optin-actions.ts";

const LABELS: Record<TelemetryOptInStatus["status"], Key> = {
  installed: "telemetry.optinInstalled",
  absent: "telemetry.optinAbsent",
  outdated: "telemetry.optinOutdated",
  conflict: "telemetry.optinConflictTitle",
};

/**
 * The host page's row for the telemetry of a plain `claude`: whether Flightdeck's exporter keys
 * are in the user's settings.json, and the install and remove that edit it, each after a
 * confirmation that names the file.
 */
export function TelemetrySection(props: Readonly<{ store: AppStore; hostId: string }>) {
  const t = useT();
  const { store, hostId } = props;
  const reasonId = useId();
  const [info, setInfo] = useState<TelemetryOptInStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState<"install" | "uninstall" | null>(null);

  const load = useCallback(() => {
    setFailed(false);
    void store.hostCommand(hostId, "telemetry.status", {}).then((result) => {
      setInfo(result ?? null);
      setFailed(!result);
    });
  }, [store, hostId]);
  useEffect(load, [load]);

  const apply = async () => {
    const kind = confirming;
    setConfirming(null);
    const result = await store.hostCommand(
      hostId,
      kind === "install" ? "telemetry.install" : "telemetry.uninstall",
      { confirm: true },
    );
    // A refusal went to the notices; the panel asks again so it shows what is really there.
    if (result) setInfo(result);
    else load();
  };

  const path = info?.settingsPath ?? "~/.claude/settings.json";
  const off = optinActions(info?.status ?? null);
  // A no-op button stays focusable (aria-disabled) so its reason can be read from it.
  const action = (kind: "install" | "uninstall") => {
    const reason = off[kind];
    const label = t(kind === "install" ? "telemetry.optinInstall" : "telemetry.optinUninstall");
    return (
      <Button
        variant="outline"
        size="sm"
        aria-disabled={reason ? true : undefined}
        aria-describedby={reason && reason !== "unknown" ? `${reasonId}-${kind}` : undefined}
        className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
        onClick={() => {
          if (!reason) setConfirming(kind);
        }}
      >
        {label}
      </Button>
    );
  };
  const hint = (kind: "install" | "uninstall") => {
    const reason = off[kind];
    return reason && reason !== "unknown" ? (
      <p id={`${reasonId}-${kind}`} className="text-muted-foreground text-xs">
        {t(reason)}
      </p>
    ) : null;
  };
  return (
    <section aria-label={t("telemetry.optinTitle")}>
      <Panel title={t("telemetry.optinTitle")}>
        <Stack gap={2}>
          <p className="text-muted-foreground text-xs">{t("telemetry.optinHint")}</p>
          {/* Always mounted, so a status that appears later is announced. */}
          <output className="text-sm">
            {failed ? "" : t(info ? LABELS[info.status] : "telemetry.optinAsking")}
          </output>
          {failed && (
            <ErrorState
              message={t("telemetry.optinFailed")}
              retryLabel={t("telemetry.retry")}
              onRetry={load}
            />
          )}
          {info && info.conflicts.length > 0 && (
            <p className="text-sm">
              {t("telemetry.optinConflict", { keys: info.conflicts.join(", ") })}
            </p>
          )}
          <Inline>
            {action("install")}
            {action("uninstall")}
          </Inline>
          {hint("install")}
          {hint("uninstall")}
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
