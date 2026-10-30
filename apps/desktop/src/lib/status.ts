import type { SessionStatus } from "@flightdeck/protocol";
import type { StateTone } from "@/components/status/status-dot";

/** A session status as the state tone of the theme (its badge color). */
export function statusTone(status: SessionStatus): StateTone {
  switch (status) {
    case "starting":
    case "running":
      return "running";
    case "awaiting_permission":
      return "needs-you";
    case "error":
      return "error";
    case "idle":
      return "idle";
    case "ended":
      return "ended";
  }
}

/** A turn is on (starting, running or waiting for a permission): files cannot go back now. */
export function isBusy(status: SessionStatus | undefined): boolean {
  return status === "starting" || status === "running" || status === "awaiting_permission";
}
