import type { MaintenanceStatus, PruneCounts } from "@flightdeck/protocol";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/i18n/context";
import { ActionButton, ConfirmDialog } from "@/shared/feedback/index.ts";
import { ErrorState, Facts, Inline, Panel } from "@/shared/layout/index.ts";
import { formatBytes, formatNumber } from "../../i18n/format.ts";
import type { Key, T } from "../../i18n/index.ts";
import type { AppStore } from "../../lib/app-store.ts";

const TABLES = new Set(["events", "permission_requests", "external_sessions"]);

const describeCounts = (counts: PruneCounts, t: T, lang: "en" | "pt-BR") =>
  Object.entries(counts)
    .map(([table, n]) => {
      const label = TABLES.has(table) ? t(`maintenance.tables.${table}` as Key) : table;
      return `${label} ${formatNumber(n, lang)}`;
    })
    .join(", ");

/**
 * The host's database: size, backups and the retention cleanup (`maintenance.*`). Cleaning up
 * for real asks first; simulating only counts.
 */
export function MaintenanceSection(props: Readonly<{ store: AppStore; hostId: string }>) {
  const t = useT();
  const { store, hostId } = props;
  const lang = store.i18n.lang;
  const [status, setStatus] = useState<MaintenanceStatus | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  // The real cleanup is going on: Clean is busy, so a second click starts no second one.
  const [cleaning, setCleaning] = useState(false);
  // The status was refused and none is on screen: the panel says so and Try again asks once more.
  const [failed, setFailed] = useState(false);
  // The host keeps one "last prune", and a simulation overwrites it. The last real cleanup seen
  // on this screen is kept apart, so Simulate never makes the panel say it cleaned up (#3998).
  const [realCleanup, setRealCleanup] = useState<MaintenanceStatus["lastPrune"]>(null);
  // `own`: the load is the panel's own (first or Try again), which has a Try again, so the toast
  // offers none that would throw the answer away; after an action the facts shown stay and the
  // toast keeps its retry.
  const refresh = useCallback(
    async (own = false) => {
      // The error stays up while Try again runs, so the keyboard focus is not dropped with it.
      const next = await store.hostCommand(hostId, "maintenance.status", {}, { retry: !own });
      setFailed(!next);
      if (next) {
        setStatus(next);
        if (next.lastPrune && !next.lastPrune.dryRun) setRealCleanup(next.lastPrune);
      }
    },
    [store, hostId],
  );
  useEffect(() => {
    void refresh(true);
  }, [refresh]);

  const backup = async () => {
    // The last outcome goes first, so a repeated one is announced again and a refusal leaves none.
    setResult(null);
    const made = await store.hostCommand(hostId, "maintenance.backup", {});
    // Status first, so the message and the new numbers show up together.
    await refresh();
    if (made) setResult(t("maintenance.backupDone", { path: made.path }));
  };
  const prune = async (dryRun: boolean) => {
    setConfirming(false);
    setResult(null);
    if (!dryRun) setCleaning(true);
    let counts: PruneCounts | null;
    try {
      counts = await store.hostCommand(hostId, "maintenance.prune", { dryRun });
      await refresh();
    } finally {
      setCleaning(false);
    }
    if (counts) {
      setResult(
        t(dryRun ? "maintenance.wouldDelete" : "maintenance.deleted", {
          counts: describeCounts(counts, t, lang),
        }),
      );
    }
  };

  const last = status?.lastBackup;
  // A host whose only record is a simulation has no real cleanup to show, unless this screen saw one.
  const cleanup = status?.lastPrune?.dryRun ? realCleanup : status?.lastPrune;
  const backupText = last
    ? t("maintenance.backupValue", {
        when: store.formatDateTime(last.at),
        size: formatBytes(last.bytes, lang),
      })
    : t("maintenance.noBackup");
  const cleanupText = cleanup
    ? store.formatDateTime(cleanup.at)
    : t(status?.lastPrune ? "maintenance.cleanupUnrecorded" : "maintenance.noCleanup");
  const noStatus = failed ? (
    <ErrorState
      message={t("maintenance.loadFailed")}
      retryLabel={t("maintenance.retry")}
      onRetry={() => void refresh(true)}
    />
  ) : (
    <p className="text-muted-foreground text-sm">{t("maintenance.asking")}</p>
  );
  return (
    <section aria-label={t("maintenance.title")}>
      <Panel title={t("maintenance.title")}>
        {status ? (
          <Facts
            items={[
              {
                id: "db",
                label: t("maintenance.fields.db"),
                value: formatBytes(status.dbBytes, lang),
              },
              {
                id: "sessions",
                label: t("maintenance.fields.sessions"),
                value: formatNumber(status.counts.sessions, lang),
              },
              {
                id: "events",
                label: t("maintenance.fields.events"),
                value: formatNumber(status.counts.events, lang),
              },
              {
                id: "external",
                label: t("maintenance.fields.external"),
                value: formatNumber(status.counts.externalSessions, lang),
              },
              { id: "lastBackup", label: t("maintenance.fields.lastBackup"), value: backupText },
              { id: "lastCleanup", label: t("maintenance.fields.lastCleanup"), value: cleanupText },
            ]}
          />
        ) : (
          noStatus
        )}
        {/* Always in the tree (empty, it takes no room but is not hidden), so a screen reader hears the outcome when it fills in. */}
        <output className="block text-sm empty:sr-only">{result}</output>
        <Inline gap={2}>
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
        </Inline>
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
