import type { DomainModule } from "../server/index.ts";
import { TraceService, type TraceServiceOptions } from "./service.ts";

/** The trace of a session (phase 23), served to the app: built from the transcript, the prices and the telemetry. */
export function createTrace(options: TraceServiceOptions) {
  const module: DomainModule<"trace"> = { server: { trace: new TraceService(options) } };
  return { modules: [module] as const };
}
