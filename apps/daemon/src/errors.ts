import type { ErrorCode } from "@flightdeck/protocol";

/** Error that maps directly to an `ack ok:false` sent to the client. */
export class FlightdeckError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    /** Why, for the app to translate: a stable key and the values its text fills in. */
    readonly reason?: string,
    readonly params?: Record<string, string | number>,
  ) {
    super(message);
    this.name = "FlightdeckError";
  }
}
