import type { MaintenanceStatus, PruneCounts } from "@flightdeck/protocol";
import { useCallback, useEffect, useState } from "react";
import { Facts } from "@/components/layout/facts";
import { Panel } from "@/components/layout/panel";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import type { Key, T } from "../i18n/index.ts";
import type { AppStore } from "../lib/app-store.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

/** Bytes as people read them: B, KB or MB with one decimal. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const TABLES = ["events", "permission_requests", "external_sessions"];

const describeCounts = (counts: PruneCounts, t: T) =>
  Object.entries(counts)
    .map(([table, n]) => {
      const label = TABLES.includes(table) ? t(`maintenance.tables.${table}` as Key) : table;
      return `${label} ${n}`;
    })
    .join(", ");

/**
 * The host's database: size, backups and the retention cleanup (`maintenance.*`). Cleaning up
 * for real asks first; simulating only counts.
 */
export function MaintenanceSection(props: { store: AppStore; hostId: string }) {
  const t = useT();
  const { store, hostId } = props;
  const [status, setStatus] = useState<MaintenanceStatus | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const refresh = useCallback(async () => {
    const next = await store.hostCommand(hostId, "maintenance.status", {});
    if (next) setStatus(next);
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
    const counts = await store.hostCommand(hostId, "maintenance.prune", { dryRun });
    await refresh();
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
        ) : (
          <p className="text-muted-foreground text-sm">{t("maintenance.asking")}</p>
        )}
        {result && <p className="text-sm">{result}</p>}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void backup()}>
            {t("maintenance.backup")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void prune(true)}>
            {t("maintenance.dry")}
          </Button>
          <Button variant="destructive" size="sm" onClick={() => setConfirming(true)}>
            {t("maintenance.clean")}
          </Button>
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
