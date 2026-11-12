import type { Database } from "bun:sqlite";
import type { QuotaWindow } from "@flightdeck/protocol";
import type { DomainModule } from "../server/index.ts";
import { activitySince } from "./since.ts";

/** What "while you were away" is read from. */
export interface ActivityWiringDeps {
  db: Database;
  /** The plan quota windows now. */
  quota: () => QuotaWindow[];
}

/** Issue #1344: "While you were away", as the module the server takes `activity` from. */
export function createActivity({ db, quota }: ActivityWiringDeps) {
  const module: DomainModule<"activity"> = {
    server: { activity: (since, limit) => activitySince({ db, quota }, since, limit) },
  };
  return { modules: [module] as const };
}
