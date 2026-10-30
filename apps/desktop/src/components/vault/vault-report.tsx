import type { VaultDecisionInfo, VaultReportRow } from "@flightdeck/protocol";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import type { Key } from "@/i18n/index";
import type { AppState, AppStore } from "@/lib/app-store";
import { hasFeature } from "@/lib/version";

const DAYS = 30;
const SELECT =
  "h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Phase 19: what the rules of a host decided in the last 30 days, by secret, requester and
 * outcome (with its CSV), and each decision with its reason. Values never show: the daemon has none.
 */
export function VaultReport(props: { store: AppStore; state: AppState }) {
  const t = useT();
  const { store, state } = props;
  const hosts = state.hosts.filter(
    (h) => h.status === "online" && hasFeature(h.hostInfo?.features, "actions", false),
  );
  const [hostId, setHostId] = useState("");
  const host = hosts.find((h) => h.id === hostId) ?? hosts[0];
  const [rows, setRows] = useState<VaultReportRow[]>([]);
  const [decisions, setDecisions] = useState<VaultDecisionInfo[]>([]);
  const name = (id: string) => state.secrets.find((s) => s.id === id)?.name ?? id;
  const requester = (r: string) => t(`actionsUi.requester.${r}` as Key);

  useEffect(() => {
    if (!host) return;
    void store.hostCommand(host.id, "vault.report", { days: DAYS }).then((report) => {
      if (report) setRows(report.rows);
    });
    void store.hostCommand(host.id, "vault.decisions", { days: DAYS }).then((result) => {
      if (result) setDecisions(result.decisions);
    });
  }, [store, host]);

  if (!host) return <p className="text-muted-foreground text-sm">{t("vaultAudit.noHost")}</p>;

  const exportCsv = async () => {
    const report = await store.hostCommand(host.id, "vault.report", { days: DAYS, format: "csv" });
    if (report?.csv !== undefined) {
      await store.saveFile(`flightdeck-cofre-${DAYS}-dias.csv`, report.csv);
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
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => void exportCsv()}>
          {t("vaultAudit.export")}
        </Button>
      </div>
      {rows.length === 0 ? (
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
            {rows.map((row) => (
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
      {decisions.length === 0 ? (
        <p className="text-muted-foreground">{t("vaultAudit.noDecisions")}</p>
      ) : (
        <ul aria-label={t("vaultAudit.decisions")} className="flex flex-col gap-1 text-xs">
          {decisions.map((d) => (
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
    </div>
  );
}
