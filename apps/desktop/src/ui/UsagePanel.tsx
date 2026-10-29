import type { UsageSummary } from "@flightdeck/protocol";
import { useEffect, useState } from "react";
import type { AppStore } from "../lib/app-store.ts";

/** Cost, tokens and turns of the host's managed sessions in the last 7 days, by day and project. */
export function UsagePanel(props: { store: AppStore; hostId: string; online: boolean }) {
  const { store, hostId, online } = props;
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  useEffect(() => {
    if (online) void store.hostCommand(hostId, "usage.summary", { days: 7 }).then(setUsage);
  }, [store, hostId, online]);

  return (
    <section aria-label="Uso dos últimos 7 dias" className="usage">
      <h3>Uso dos últimos 7 dias</h3>
      <p className="muted">Só sessões gerenciadas; o custo é a estimativa que o SDK informa.</p>
      <table>
        <thead>
          <tr>
            <th>Dia</th>
            <th>Projeto</th>
            <th>Custo</th>
            <th>Tokens</th>
            <th>Turnos</th>
          </tr>
        </thead>
        <tbody>
          {(usage?.rows ?? []).map((row) => (
            <tr key={`${row.day}/${row.projectKey}`}>
              <td>{row.day}</td>
              <td>{row.projectKey}</td>
              <td>{`US$ ${row.costUsd.toFixed(2)}`}</td>
              <td>{`${row.inputTokens} / ${row.outputTokens}`}</td>
              <td>{`${row.turns} ${row.turns === 1 ? "turno" : "turnos"}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
