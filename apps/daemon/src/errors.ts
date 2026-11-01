import type { ErrorCode, RuleIssue } from "@flightdeck/protocol";

/** Error that maps directly to an `ack ok:false` sent to the client. */
export class FlightdeckError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    /** Why, for the app to translate: a stable key and the values its text fills in. */
    readonly reason?: string,
    readonly params?: Record<string, string | number>,
    /** What is wrong in a list the person typed, one item per problem (a vault rule). */
    readonly items?: readonly RuleIssue[],
  ) {
    super(message);
    this.name = "FlightdeckError";
  }
}

/** A command that needs a part this daemon runs without: the app names the feature in its language. */
export function featureOff(feature: string): FlightdeckError {
  return new FlightdeckError("invalid_state", `${feature} is off on this host`, "feature_off", {
    feature,
  });
}
