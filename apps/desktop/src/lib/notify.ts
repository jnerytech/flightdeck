import type { SessionEvent } from "@flightdeck/protocol";

export interface Notification {
  title: string;
  body: string;
}

/** Desktop notification for an event, only while the window is not focused. */
export function notificationFor(
  event: SessionEvent,
  label: string,
  focused: boolean,
): Notification | null {
  if (focused) return null;
  if (event.type === "permission.requested") {
    return { title: `${label}: esperando você`, body: `Permitir ${event.toolName}?` };
  }
  if (event.type === "turn.result") {
    return { title: `${label}: turno concluído`, body: event.subtype };
  }
  return null;
}
