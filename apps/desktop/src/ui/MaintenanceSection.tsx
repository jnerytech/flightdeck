import type { MaintenanceStatus, PruneCounts } from "@flightdeck/protocol";
import { useCallback, useEffect, useState } from "react";
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
    .map(
      ([table, n]) =>
        `${TABLES.includes(table) ? t(`maintenance.tables.${table}` as Key) : table} ${n}`,
    )
    .join(", ");

const when = (iso: string) => new Date(iso).toLocaleString();

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
  return (
    <section aria-label={t("maintenance.title")}>
      <Panel title={t("maintenance.title")}>
        {status ? (
          <ul className="flex flex-col gap-1 text-sm">
            <li>{t("maintenance.db", { size: formatBytes(status.dbBytes) })}</li>
            <li>
              {t("maintenance.counts", {
                sessions: status.counts.sessions,
                events: status.counts.events,
                external: status.counts.externalSessions,
              })}
            </li>
            <li>
              {last
                ? t("maintenance.lastBackup", {
                    when: when(last.at),
                    size: formatBytes(last.bytes),
                  })
                : t("maintenance.noBackup")}
            </li>
            <li>
              {cleanup
                ? t("maintenance.lastCleanup", { when: when(cleanup.at) }) +
                  (cleanup.dryRun ? t("maintenance.dryRun") : "")
                : t("maintenance.noCleanup")}
            </li>
          </ul>
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
