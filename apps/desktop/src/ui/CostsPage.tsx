import type { CostsFilter, CostsStatus, CostsSummary, UsageOrigin } from "@flightdeck/protocol";
import { useEffect, useState } from "react";
import type { AppState, AppStore } from "../lib/app-store.ts";
import { daysBetween, PERIOD_LABELS, type Period, periodRange, usd } from "../lib/costs.ts";
import { basename } from "../lib/paths.ts";
import { hasFeature } from "../lib/version.ts";
import { QuotaCharts } from "./QuotaCharts.tsx";

const ORIGINS: UsageOrigin[] = ["terminal", "app", "card", "workflow", "subagent"];

export type TopSession = CostsSummary["topSessions"][number];

const tokensOf = (t: CostsSummary["totals"]["tokens"]) =>
  t.input + t.output + t.cacheRead + t.cacheWrite5m + t.cacheWrite1h;

/** A breakdown as a two-column table. */
function Breakdown(props: { name: string; rows: Array<{ label: string; costUsd: number }> }) {
  return (
    <section aria-label={props.name} className="costs-breakdown">
      <h3>{props.name}</h3>
      <table>
        <tbody>
          {props.rows.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td>{usd(row.costUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * Estimated cost of every session of a host (terminal, app, cards and workflows), from the
 * transcripts, in API prices: totals, a daily chart stacked by project, breakdowns, the most
 * expensive sessions and a CSV export.
 */
export function CostsPage(props: {
  store: AppStore;
  state: AppState;
  onOpenSession(hostId: string, session: TopSession): void;
}) {
  const { store, state } = props;
  const hosts = state.hosts.filter(
    (h) => h.status === "online" && hasFeature(h.hostInfo?.features, "costs", false),
  );
  const [hostId, setHostId] = useState(hosts[0]?.id ?? "");
  const [period, setPeriod] = useState<Period>("7d");
  const today = store.today();
  const [range, setRange] = useState(periodRange("7d", today));
  const [filters, setFilters] = useState<Omit<CostsFilter, "from" | "to">>({});
  const [summary, setSummary] = useState<CostsSummary | null>(null);
  /** The period without filters: the filters offer every project and model of it. */
  const [all, setAll] = useState<CostsSummary | null>(null);
  const [status, setStatus] = useState<CostsStatus | null>(null);
  const days = period === "range" ? range : periodRange(period, today);
  const filter: CostsFilter = { ...days, ...filters };
  const key = JSON.stringify([hostId, filter]);
  useEffect(() => {
    if (!hostId) return;
    void store.hostCommand(hostId, "costs.summary", JSON.parse(key)[1]).then(setSummary);
  }, [store, hostId, key]);
  const daysKey = JSON.stringify([hostId, days]);
  useEffect(() => {
    if (!hostId) return;
    void store.hostCommand(hostId, "costs.summary", JSON.parse(daysKey)[1]).then(setAll);
  }, [store, hostId, daysKey]);
  useEffect(() => {
    if (hostId) void store.hostCommand(hostId, "costs.status", {}).then(setStatus);
  }, [store, hostId]);
  const setFilter = (name: keyof typeof filters, value: string) => {
    const { [name]: _old, ...rest } = filters;
    setFilters(value ? { ...rest, [name]: value } : rest);
  };
  const exportCsv = async () => {
    const file = await store.hostCommand(hostId, "costs.export", filter);
    if (file) await store.saveFile(file.filename, file.csv);
  };
  const byDay = summary?.byDay ?? [];
  const dayTotals = new Map<string, number>();
  for (const row of byDay) dayTotals.set(row.day, (dayTotals.get(row.day) ?? 0) + row.costUsd);
  const highest = Math.max(0, ...dayTotals.values());

  return (
    <section aria-label="Custos" className="costs">
      <h2>Custos</h2>
      <p className="notice">equivalente em API, estimado; em assinatura, não é cobrado</p>
      {status && status.divergences.length > 0 && (
        <p className="warning">
          {`tabela de preços pode estar desatualizada: ${status.divergences
            .map((d) => `${d.model} (calculado ${usd(d.computedUsd)}, SDK ${usd(d.sdkUsd)})`)
            .join("; ")}`}
        </p>
      )}
      <div className="row filters">
        <select
          aria-label="Host dos custos"
          value={hostId}
          onChange={(e) => setHostId(e.target.value)}
        >
          {hosts.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
        {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
          <button key={p} type="button" aria-pressed={period === p} onClick={() => setPeriod(p)}>
            {PERIOD_LABELS[p]}
          </button>
        ))}
        {period === "range" && (
          <>
            <input
              type="date"
              aria-label="De"
              value={range.from}
              onChange={(e) => setRange({ ...range, from: e.target.value })}
            />
            <input
              type="date"
              aria-label="Até"
              value={range.to}
              onChange={(e) => setRange({ ...range, to: e.target.value })}
            />
          </>
        )}
        <select
          aria-label="Projeto"
          value={filters.projectKey ?? ""}
          onChange={(e) => setFilter("projectKey", e.target.value)}
        >
          <option value="">Todos os projetos</option>
          {(all?.byProject ?? []).map((p) => (
            <option key={p.projectKey} value={p.projectKey}>
              {p.projectKey}
            </option>
          ))}
        </select>
        <select
          aria-label="Modelo"
          value={filters.model ?? ""}
          onChange={(e) => setFilter("model", e.target.value)}
        >
          <option value="">Todos os modelos</option>
          {(all?.byModel ?? []).map((m) => (
            <option key={m.model} value={m.model}>
              {m.model}
            </option>
          ))}
        </select>
        <select
          aria-label="Origem"
          value={filters.origin ?? ""}
          onChange={(e) => setFilter("origin", e.target.value)}
        >
          <option value="">Todas as origens</option>
          {ORIGINS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => void exportCsv()}>
          Exportar CSV
        </button>
      </div>
      {summary && (
        <>
          <dl className="costs-totals">
            <dt>Custo estimado</dt>
            <dd>
              <output aria-label="Custo estimado">{usd(summary.totals.costUsd)}</output>
            </dd>
            <dt>Tokens</dt>
            <dd>
              <output aria-label="Tokens">{String(tokensOf(summary.totals.tokens))}</output>
            </dd>
            <dt>Economia do cache</dt>
            <dd>
              <output aria-label="Economia do cache">{usd(summary.totals.cacheSavingsUsd)}</output>
            </dd>
          </dl>
          {(status?.unpriced ?? []).map((u) => (
            <p key={u.model} className="muted">{`sem preço: ${u.model}`}</p>
          ))}
          <section aria-label="Custo por dia" className="costs-chart">
            {daysBetween(days.from, days.to).map((day) => (
              <div key={day} data-day={day} className="costs-day" title={day}>
                {byDay
                  .filter((row) => row.day === day)
                  .map((row) => (
                    <div
                      key={row.projectKey}
                      role="img"
                      aria-label={`${day} · ${row.projectKey}: ${usd(row.costUsd)}`}
                      className="costs-segment"
                      style={{ height: `${highest > 0 ? (row.costUsd / highest) * 100 : 0}%` }}
                    />
                  ))}
              </div>
            ))}
          </section>
          <Breakdown
            name="Por projeto"
            rows={summary.byProject.map((p) => ({ label: p.projectKey, costUsd: p.costUsd }))}
          />
          <Breakdown
            name="Por modelo"
            rows={summary.byModel.map((m) => ({ label: m.model, costUsd: m.costUsd }))}
          />
          <Breakdown
            name="Por origem"
            rows={summary.byOrigin.map((o) => ({ label: o.origin, costUsd: o.costUsd }))}
          />
          <QuotaCharts key={hostId} store={store} hostId={hostId} />
          <section aria-label="Top sessões" className="costs-top">
            <h3>Top sessões</h3>
            <ul>
              {summary.topSessions.map((s) => (
                <li key={s.claudeSessionId}>
                  <button type="button" onClick={() => props.onOpenSession(hostId, s)}>
                    {`${s.title ?? basename(s.cwd ?? s.claudeSessionId)} · ${s.projectKey} · ${usd(s.costUsd)}`}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </section>
  );
}
