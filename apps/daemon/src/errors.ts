import type { ErrorCode } from "@flightdeck/protocol";

/** Error that maps directly to an `ack ok:false` sent to the client. */
export class FlightdeckError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FlightdeckError";
  }
}
