import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { ApprovalCard } from "@/components/approval/approval-card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatAgo } from "../i18n/format.ts";
import type { T } from "../i18n/index.ts";
import { type AppState, type HostView, needsYou, type PendingItem } from "../lib/app-store.ts";
import { budgetAlerts } from "../lib/budgets.ts";
import type { ConnectionStatus } from "../lib/host-connection.ts";
import { basename } from "../lib/paths.ts";
import { inputSummary } from "../lib/tool-input.ts";
import { APP_VERSION, hasFeature } from "../lib/version.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { StatusBadge } from "./StatusBadge.tsx";

const CONNECTION_LABELS: Record<ConnectionStatus, string> = {
  online: "online",
  offline: "offline",
  connecting: "reconectando",
  unauthorized: "token recusado",
  incompatible: "incompatível: atualize o daemon",
};

/** Hosts with their connection state and, inside each, the sessions with a status badge. */
export function Sidebar(props: {
  state: AppState;
  onSelect(hostId: string, sessionId: string | null): void;
  onRemoveHost(hostId: string): void;
  onAddHost(): void;
  onOpenRequest(item: PendingItem): void;
  /** Aprovar or Negar in the queue's expanded card; `message` is the reason (or a gate's note). */
  onRespond(item: PendingItem, decision: "allow" | "deny", message?: string): void;
  /** The app's translator and clock (phase 10): the queue's card and the request's age. */
  t: T;
  nowMs: number;
  /** Copies a text (the queue card's folder). */
  onCopyText(text: string): void;
  onOpenHost(hostId: string): void;
  onOpenSettings(): void;
  onOpenSearch(): void;
  onOpenHistory(hostId: string): void;
  onOpenProjects(hostId: string): void;
  onOpenHub(): void;
  onOpenCosts(): void;
  onOpenBudgets(): void;
}) {
  const { state } = props;
  const queue = needsYou(state);
  /** The queue's request whose card is open (one at a time). */
  const [expanded, setExpanded] = useState<string | null>(null);
  /** The host whose removal is being confirmed. */
  const [removing, setRemoving] = useState<HostView | null>(null);
  const alerts = budgetAlerts(state);
  return (
    <nav className="sidebar">
      <button
        type="button"
        className="hub-link"
        aria-label="Abrir Sessões"
        onClick={props.onOpenHub}
      >
        Sessões
      </button>
      {/* Hosts from phase 8 on read their costs from the transcripts. */}
      {state.hosts.some((h) => hasFeature(h.hostInfo?.features, "costs", false)) && (
        <button type="button" className="hub-link" onClick={props.onOpenCosts}>
          Custos
        </button>
      )}
      {queue.length + alerts.length > 0 && (
        <section className="needs-you">
          <h3>Precisa de você ({queue.length + alerts.length})</h3>
          <ul>
            {alerts.map((alert) => (
              <li key={alert.label}>
                <button type="button" onClick={props.onOpenBudgets}>
                  {alert.label}
                </button>
              </li>
            ))}
            {queue.map((item) => {
              const label = `${item.hostName} · ${item.sessionName}: ${item.toolName}`;
              const key = `${item.hostId}/${item.requestId}`;
              const open = expanded === key;
              const summary = inputSummary(item.input);
              return (
                <li key={key} className="flex flex-col gap-2">
                  <button
                    type="button"
                    aria-label={label}
                    aria-expanded={open}
                    onClick={() => setExpanded(open ? null : key)}
                    className="flex w-full min-w-0 flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-sidebar-accent"
                  >
                    <span className="w-full truncate text-sm">{`${item.hostName} · ${item.sessionName}`}</span>
                    <span className="w-full truncate text-muted-foreground text-xs">
                      {summary ? `${item.toolName}: ${summary}` : item.toolName}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {formatAgo(props.nowMs - Date.parse(item.createdAt), props.t)}
                    </span>
                  </button>
                  {open && (
                    <ApprovalCard
                      request={{
                        requestId: item.requestId,
                        toolName: item.toolName,
                        input: item.input ?? {},
                        cwd: item.cwd ?? null,
                        createdAt: item.createdAt,
                      }}
                      t={props.t}
                      nowMs={props.nowMs}
                      onCopyPath={props.onCopyText}
                      onRespond={(decision, message) => props.onRespond(item, decision, message)}
                      actions={
                        <Button
                          variant="ghost"
                          onClick={() => {
                            // The opened screen shows the card: the queue's copy closes.
                            setExpanded(null);
                            props.onOpenRequest(item);
                          }}
                        >
                          {props.t(item.gate ? "approval.openCard" : "approval.openSession")}
                        </Button>
                      }
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {state.hosts.map((host) => (
        <div key={host.id} className="host">
          <div className="host-header">
            <span
              className={`dot dot-${host.status}`}
              role="img"
              aria-label={`${host.name}: ${CONNECTION_LABELS[host.status]}`}
            />
            <button
              type="button"
              className="host-name"
              aria-label={`Abrir host ${host.name}`}
              onClick={() => props.onOpenHost(host.id)}
            >
              {host.name}
            </button>
            {host.hostInfo?.apiKeySanitized === false && (
              <span
                className="badge badge-warn"
                role="img"
                aria-label={`${host.name}: chave de API repassada`}
              >
                ⚠
              </span>
            )}
            {host.hostInfo && host.hostInfo.daemonVersion !== APP_VERSION && (
              <span
                className="badge badge-warn"
                role="img"
                aria-label={`${host.name}: versão diferente`}
                title={`flightdeckd ${host.hostInfo.daemonVersion}, app ${APP_VERSION}`}
              >
                ≠
              </span>
            )}
            {/* An incompatible host offers nothing but its page and removal. */}
            {host.status !== "incompatible" && (
              <>
                <button
                  type="button"
                  className="icon"
                  aria-label={`Histórico de ${host.name}`}
                  onClick={() => props.onOpenHistory(host.id)}
                >
                  🕘
                </button>
                {hasFeature(host.hostInfo?.features, "workflows", true) && (
                  <button
                    type="button"
                    className="icon"
                    aria-label={`Projetos de ${host.name}`}
                    onClick={() => props.onOpenProjects(host.id)}
                  >
                    ▦
                  </button>
                )}
                <button
                  type="button"
                  className="icon"
                  aria-label={`Nova sessão em ${host.name}`}
                  onClick={() => props.onSelect(host.id, null)}
                >
                  +
                </button>
              </>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={`Menu de ${host.name}`}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => setRemoving(host)}>Remover host</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <ul>
            {host.sessions.map((s) => {
              const active =
                state.selected?.hostId === host.id && state.selected.sessionId === s.id;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    className={active ? "session-item active" : "session-item"}
                    onClick={() => props.onSelect(host.id, s.id)}
                  >
                    <span className="session-name">{s.name ?? basename(s.cwd)}</span>
                    <span className="muted">{basename(s.cwd)}</span>
                    <StatusBadge status={s.status} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <button type="button" className="add-host" onClick={props.onAddHost}>
        Adicionar outro host
      </button>
      <button type="button" className="add-host" onClick={props.onOpenSearch}>
        Buscar no histórico (Ctrl+K)
      </button>
      <button type="button" className="add-host" onClick={props.onOpenSettings}>
        Configurações
      </button>
      {removing && (
        <ConfirmDialog
          message={`Remover o host ${removing.name}? As sessões dele saem da lista; o daemon continua rodando.`}
          confirmLabel="Remover host"
          destructive
          onConfirm={() => {
            props.onRemoveHost(removing.id);
            setRemoving(null);
          }}
          onCancel={() => setRemoving(null)}
        />
      )}
    </nav>
  );
}
