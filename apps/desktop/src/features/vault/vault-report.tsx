import type { VaultDecisionInfo, VaultReportRow } from "@flightdeck/protocol";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/context";
import type { Key } from "@/i18n/index";
import type { AppStore } from "@/lib/app-store";
import { useStoreSlice } from "@/lib/use-store";
import { hostsWith } from "@/lib/version";
import { ActionButton } from "@/shared/feedback/index.ts";
import { ErrorState, LoadingState } from "@/shared/layout/index.ts";

const DAYS = 30;
const SELECT =
  "h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";

const VAULTREPORT_KEYS = ["secrets", "hosts"] as const;

/**
 * Phase 19: what the rules of a host decided in the last 30 days, by secret, requester and
 * outcome (with its CSV), and each decision with its reason. Values never show: the daemon has none.
 */
export const VaultReport = memo(function VaultReport(props: { store: AppStore }) {
  const t = useT();
  const { store } = props;
  const state = useStoreSlice(store, VAULTREPORT_KEYS);
  const hosts = hostsWith(state.hosts, "actions");
  const [hostId, setHostId] = useState("");
  const host = hosts.find((h) => h.id === hostId) ?? hosts[0];
  // Null until the host answers, so a refused or slow read is never shown as "no use". It names its host, so a render after a host change never shows the previous host's rows.
  const [data, setData] = useState<{
    hostId: string;
    rows: VaultReportRow[];
    decisions: VaultDecisionInfo[];
  } | null>(null);
  const [failed, setFailed] = useState(false);
  // The newest read only: an older answer (another host, an earlier try) is dropped.
  const latest = useRef(0);
  const hostKey = host?.id;
  const name = (id: string) => state.secrets.find((s) => s.id === id)?.name ?? id;
  const requester = (r: string) => t(`actionsUi.requester.${r}` as Key);

  // The tab has its own error and Try again, so the toast offers no retry (it would drop the answer).
  const load = useCallback(async () => {
    if (!hostKey) return;
    latest.current += 1;
    const mine = latest.current;
    const [report, decided] = await Promise.all([
      store.hostCommand(hostKey, "vault.report", { days: DAYS }, { retry: false }),
      store.hostCommand(hostKey, "vault.decisions", { days: DAYS }, { retry: false }),
    ]);
    if (mine !== latest.current) return;
    setFailed(!report || !decided);
    if (report && decided)
      setData({ hostId: hostKey, rows: report.rows, decisions: decided.decisions });
  }, [store, hostKey]);

  // Another host starts from nothing: its table does not show the previous host's rows.
  useEffect(() => {
    setData(null);
    setFailed(false);
    void load();
    return () => {
      latest.current += 1;
    };
  }, [load]);

  const shown = data?.hostId === hostKey ? data : null;
  if (!host) return <p className="text-muted-foreground text-sm">{t("vaultAudit.noHost")}</p>;

  const exportCsv = async () => {
    const report = await store.hostCommand(host.id, "vault.report", { days: DAYS, format: "csv" });
    if (report?.csv !== undefined) {
      await store.system.saveFile(`flightdeck-cofre-${DAYS}-dias.csv`, report.csv);
    }
  };

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {hosts.length > 1 && (
          <select
            aria-label={t("vaultAudit.host")}
            className={SELECT}
            value={host.id}
            onChange={(e) => setHostId(e.target.value)}
          >
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        )}
        <span className="text-muted-foreground text-xs">{t("vaultAudit.days")}</span>
        <ActionButton variant="outline" size="sm" className="ml-auto" onClick={() => exportCsv()}>
          {t("vaultAudit.export")}
        </ActionButton>
      </div>
      {failed && (
        <ErrorState
          message={t("vaultAudit.failed")}
          retryLabel={t("vaultAudit.retry")}
          onRetry={() => void load()}
        />
      )}
      {!failed && shown === null && <LoadingState label={t("vaultAudit.loading")} />}
      {!failed && shown !== null && (
        <>
          {shown.rows.length === 0 ? (
            <p className="text-muted-foreground">{t("vaultAudit.empty")}</p>
          ) : (
            <table aria-label={t("vaultAudit.table")} className="w-full text-left text-xs">
              <thead>
                <tr>
                  <th>{t("vaultAudit.secret")}</th>
                  <th>{t("vaultAudit.requester")}</th>
                  <th>{t("vaultAudit.outcome")}</th>
                  <th className="text-right">{t("vaultAudit.count")}</th>
                </tr>
              </thead>
              <tbody>
                {shown.rows.map((row) => (
                  <tr key={`${row.secretId}|${row.requester}|${row.outcome}`}>
                    <td>{name(row.secretId)}</td>
                    <td>{requester(row.requester)}</td>
                    <td>{t(`vaultAudit.outcomes.${row.outcome}`)}</td>
                    <td className="text-right tabular-nums">{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {shown.decisions.length === 0 ? (
            <p className="text-muted-foreground">{t("vaultAudit.noDecisions")}</p>
          ) : (
            <ul aria-label={t("vaultAudit.decisions")} className="flex flex-col gap-1 text-xs">
              {shown.decisions.map((d) => (
                <li key={d.id} className="flex flex-wrap gap-x-2">
                  <time dateTime={d.at} className="text-muted-foreground tabular-nums">
                    {store.formatDateTime(d.at)}
                  </time>
                  <span>{name(d.secretId)}</span>
                  {d.action && <span className="font-mono">{d.action}</span>}
                  <span>{requester(d.requester)}</span>
                  <strong>{t(`vaultAudit.outcomes.${d.outcome}`)}</strong>
                  {d.approver && <span>{t(`vaultAudit.approvers.${d.approver}`)}</span>}
                  <span className="text-muted-foreground">{d.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
});
