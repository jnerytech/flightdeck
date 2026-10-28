import type { SessionStatus } from "@flightdeck/protocol";

export const STATUS_LABELS: Record<SessionStatus, string> = {
  starting: "iniciando",
  running: "rodando",
  awaiting_permission: "esperando você",
  idle: "ociosa",
  ended: "encerrada",
  error: "erro",
};

export type StatusTone = "active" | "warn" | "muted" | "danger";

export function statusTone(status: SessionStatus): StatusTone {
  switch (status) {
    case "starting":
    case "running":
      return "active";
    case "awaiting_permission":
      return "warn";
    case "error":
      return "danger";
    default:
      return "muted";
  }
}
