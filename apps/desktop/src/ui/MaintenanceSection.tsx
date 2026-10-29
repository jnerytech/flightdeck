import type { MaintenanceStatus, PruneCounts } from "@flightdeck/protocol";
import { useCallback, useEffect, useState } from "react";
import type { AppStore } from "../lib/app-store.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

/** Bytes as people read them: B, KB or MB with one decimal. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const TABLE_LABELS: Record<string, string> = {
  events: "eventos",
  permission_requests: "pedidos de permissão",
  external_sessions: "sessões externas",
};

const describeCounts = (counts: PruneCounts) =>
  Object.entries(counts)
    .map(([table, n]) => `${TABLE_LABELS[table] ?? table} ${n}`)
    .join(", ");

const when = (iso: string) => new Date(iso).toLocaleString();

/**
 * The host's database: size, backups and the retention cleanup (`maintenance.*`). Cleaning up
 * for real asks first; simulating only counts.
 */
export function MaintenanceSection(props: { store: AppStore; hostId: string }) {
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
    if (made) setResult(`backup criado: ${made.path}`);
  };
  const prune = async (dryRun: boolean) => {
    setConfirming(false);
    const counts = await store.hostCommand(hostId, "maintenance.prune", { dryRun });
    await refresh();
    if (counts) {
      setResult(`${dryRun ? "seriam apagados" : "apagados"}: ${describeCounts(counts)}`);
    }
  };

  const last = status?.lastBackup;
  const cleanup = status?.lastPrune;
  return (
    <section aria-label="Manutenção" className="maintenance">
      <h3>Manutenção</h3>
      {status ? (
        <ul>
          <li>{`banco: ${formatBytes(status.dbBytes)}`}</li>
          <li>
            {`sessões: ${status.counts.sessions} · eventos: ${status.counts.events} · sessões externas: ${status.counts.externalSessions}`}
          </li>
          <li>
            {last
              ? `último backup: ${when(last.at)} (${formatBytes(last.bytes)})`
              : "último backup: nenhum ainda"}
          </li>
          <li>
            {cleanup
              ? `última limpeza: ${when(cleanup.at)}${cleanup.dryRun ? " (simulação)" : ""}`
              : "última limpeza: nenhuma ainda"}
          </li>
        </ul>
      ) : (
        <p className="muted">consultando…</p>
      )}
      {result && <p>{result}</p>}
      <div className="row">
        <button type="button" onClick={() => void backup()}>
          Fazer backup agora
        </button>
        <button type="button" onClick={() => void prune(true)}>
          Simular
        </button>
        <button type="button" className="danger" onClick={() => setConfirming(true)}>
          Limpar
        </button>
      </div>
      {confirming && (
        <ConfirmDialog
          message="Apagar os dados antigos deste host conforme a retenção configurada? Eventos de conversas encerradas e sessões externas antigas não voltam (a não ser por um backup)."
          onConfirm={() => void prune(false)}
          onCancel={() => setConfirming(false)}
        />
      )}
    </section>
  );
}
