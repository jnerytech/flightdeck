/** Stub. */
export type Requester = "claude" | "automation" | "workflow" | "unknown";

/** Stub. */
export function requesterOf(_raw: unknown): Requester {
  return "claude";
}

export interface RequestDecision {
  granted: boolean;
  requester: Requester;
  reason: string;
}

/** Stub. */
export function decideRequest(_raw: { requester?: unknown }): RequestDecision {
  return { granted: true, requester: "claude", reason: "" };
}
