import { FlightdeckError } from "../errors.ts";
import type { RiskLevel } from "./risk.ts";

/**
 * An allow of a high-risk request carries the proof that the Approve was held (`held: true`,
 * #245/#251): the daemon refuses it otherwise, below every client. A deny, and the allow of a
 * request of lower risk, never need it. The request stays open after a refusal.
 */
export function requireHold(level: RiskLevel, held: boolean | undefined): void {
  if (level !== "high" || held === true) return;
  throw new FlightdeckError(
    "invalid_state",
    "a high-risk request is allowed only with the hold of the Approve (held: true)",
    "hold_required",
  );
}
