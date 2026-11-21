import type { MaintenanceStatus, PruneCounts } from "@flightdeck/protocol";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/i18n/context";
import { ActionButton, ConfirmDialog } from "@/shared/feedback/index.ts";
import { ErrorState, Facts, Panel } from "@/shared/layout/index.ts";
import { formatBytes } from "@/shared/lib/index.ts";
import type { Key, T } from "../../i18n/index.ts";
import type { AppStore } from "../../lib/app-store.ts";

export { formatBytes };

const TABLES = new Set(["events", "permission_requests", "external_sessions"]);

const describeCounts = (counts: PruneCounts, t: T) =>
  Object.entries(counts)
    .map(([table, n]) => {
      const label = TABLES.has(table) ? t(`maintenance.tables.${table}` as Key) : table;
      return `${label} ${n}`;
    })
    .join(", ");

/**
 * The host's database: size, backups and the retention cleanup (`maintenance.*`). Cleaning up
 * for real asks first; simulating only counts.
 */
export function MaintenanceSection(props: Readonly<{ store: AppStore; hostId: string }>) {
  const t = useT();
  const { store, hostId } = props;
  const [status, setStatus] = useState<MaintenanceStatus | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  // The real cleanup is going on: Clean is busy, so a second click starts no second one.
  const [cleaning, setCleaning] = useState(false);
  // The status was refused and none is on screen: the panel says so and Try again asks once more.
  const [failed, setFailed] = useState(false);
  const refresh = useCallback(async () => {
    setFailed(false);
    // The panel has its own Try again, so the toast offers none that would throw the answer away.
    const next = await store.hostCommand(hostId, "maintenance.status", {}, { retry: false });
    if (next) setStatus(next);
    else setFailed(true);
  }, [store, hostId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const backup = async () => {
    const made = await store.hostCommand(hostId, "maintenance.backup", {});
    // Status first, so the message and the new numbers show up together.
    await refresh();
    if (made) setResult(t("maintenance.backupDone", { path: made.path }));
  };
  const prune = async (dryRun: boolean) => {
    setConfirming(false);
    if (!dryRun) setCleaning(true);
    const counts = await store.hostCommand(hostId, "maintenance.prune", { dryRun });
    await refresh();
    setCleaning(false);
    if (counts) {
      setResult(
        t(dryRun ? "maintenance.wouldDelete" : "maintenance.deleted", {
          counts: describeCounts(counts, t),
        }),
      );
    }
  };

  const last = status?.lastBackup;
  const cleanup = status?.lastPrune;
  const backupText = last
    ? t("maintenance.backupValue", {
        when: store.formatDateTime(last.at),
        size: formatBytes(last.bytes),
      })
    : t("maintenance.noBackup");
  const dryRunNote = cleanup?.dryRun ? t("maintenance.dryRun") : "";
  const cleanupText = cleanup
    ? store.formatDateTime(cleanup.at) + dryRunNote
    : t("maintenance.noCleanup");
  return (
    <section aria-label={t("maintenance.title")}>
      <Panel title={t("maintenance.title")}>
        {status ? (
          <Facts
            items={[
              { id: "db", label: t("maintenance.fields.db"), value: formatBytes(status.dbBytes) },
              {
                id: "sessions",
                label: t("maintenance.fields.sessions"),
                value: status.counts.sessions,
              },
              { id: "events", label: t("maintenance.fields.events"), value: status.counts.events },
              {
                id: "external",
                label: t("maintenance.fields.external"),
                value: status.counts.externalSessions,
              },
              { id: "lastBackup", label: t("maintenance.fields.lastBackup"), value: backupText },
              { id: "lastCleanup", label: t("maintenance.fields.lastCleanup"), value: cleanupText },
            ]}
          />
        ) : failed ? (
          <ErrorState
            message={t("maintenance.loadFailed")}
            retryLabel={t("maintenance.retry")}
            onRetry={() => void refresh()}
          />
        ) : (
          <p className="text-muted-foreground text-sm">{t("maintenance.asking")}</p>
        )}
        {/* Always there, so a screen reader hears the outcome when it fills in. */}
        <p role="status" className="text-sm empty:hidden">
          {result}
        </p>
        <div className="flex gap-2">
          <ActionButton variant="outline" size="sm" onClick={() => backup()}>
            {t("maintenance.backup")}
          </ActionButton>
          <ActionButton variant="outline" size="sm" onClick={() => prune(true)}>
            {t("maintenance.dry")}
          </ActionButton>
          <ActionButton
            variant="destructive"
            size="sm"
            pending={cleaning}
            onClick={() => setConfirming(true)}
          >
            {t("maintenance.clean")}
          </ActionButton>
        </div>
      </Panel>
      {confirming && (
        <ConfirmDialog
          message={t("maintenance.message")}
          confirmLabel={t("maintenance.clean")}
          destructive
          onConfirm={() => void prune(false)}
          onCancel={() => setConfirming(false)}
        />
      )}
    </section>
  );
}
