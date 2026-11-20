/** Issue #3460: what `flightdeckd costs` takes and says, as pure rules over the daemon's answers. */
import type { UsageOrigin } from "@flightdeck/protocol";

export interface CostsCliArgs {
  action: "summary" | "session" | "card" | "run" | "status" | "export";
  /** `session`: the Claude session id; `card`: the card id; `run`: the run id. */
  id?: string;
  /** `summary` and `export`: the first and last day (`YYYY-MM-DD`), and the filters. */
  from?: string;
  to?: string;
  projectKey?: string;
  model?: string;
  origin?: UsageOrigin;
  json?: boolean;
}
