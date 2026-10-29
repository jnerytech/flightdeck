import type { UsageSummary } from "@flightdeck/protocol";
import { useEffect, useState } from "react";
import type { AppStore } from "../lib/app-store.ts";
import { periodRange, usd } from "../lib/costs.ts";

interface Row {
  day: string;
  projectKey: string;
  costUsd: number;
  tokens: string;
  turns: string | null;
}

/**
 * The host's last 7 days, by day and project: from phase 8 on, the estimated cost of every
 * session read from the transcripts (`costs.summary`); before it, what the SDK reported for the
 * managed sessions (`usage.summary`).
 */
export function UsagePanel(props: {
  store: AppStore;
  hostId: string;
  online: boolean;
  costs: boolean;
}) {
  const { store, hostId, online, costs } = props;
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    if (!online) return;
    if (costs) {
      void store
        .hostCommand(hostId, "costs.summary", periodRange("7d", store.today()))
        .then((summary) =>
          setRows(
            (summary?.byDay ?? [])
              .map((r) => ({ ...r, tokens: String(r.tokens), turns: null }))
              .sort((a, b) => b.day.localeCompare(a.day)),
          ),
        );
      return;
    }
    void store
      .hostCommand(hostId, "usage.summary", { days: 7 })
      .then((usage: UsageSummary | null) =>
        setRows(
          (usage?.rows ?? []).map((r) => ({
            ...r,
            tokens: `${r.inputTokens} / ${r.outputTokens}`,
            turns: `${r.turns} ${r.turns === 1 ? "turno" : "turnos"}`,
          })),
        ),
      );
  }, [store, hostId, online, costs]);

  return (
    <section aria-label="Uso dos últimos 7 dias" className="usage">
      <h3>Uso dos últimos 7 dias</h3>
      <p className="muted">
        {costs
          ? "Todas as sessões do host; custo estimado em preços de API."
          : "Só sessões gerenciadas; o custo é a estimativa que o SDK informa."}
      </p>
      <table>
        <thead>
          <tr>
            <th>Dia</th>
            <th>Projeto</th>
            <th>Custo</th>
            <th>Tokens</th>
            {!costs && <th>Turnos</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.day}/${row.projectKey}`}>
              <td>{row.day}</td>
              <td>{row.projectKey}</td>
              <td>{usd(row.costUsd)}</td>
              <td>{row.tokens}</td>
              {row.turns !== null && <td>{row.turns}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
