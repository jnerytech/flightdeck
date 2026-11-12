import type { Database } from "bun:sqlite";
import type { DomainModule } from "../server/index.ts";
import { RoiSignals } from "./signals.ts";
import { RoiSummarizer } from "./summary.ts";

/** What the return-on-cost summary is built from. */
export interface RoiDeps {
  db: Database;
  /** The project key of a folder, once the host knows it. */
  keyOf(path: string): string;
}

/** The return-on-cost summary over what the daemon stored, as the module the server takes `roi` from. */
export function createRoi({ db, keyOf }: RoiDeps) {
  const module: DomainModule<"roi"> = {
    server: { roi: new RoiSummarizer({ db, keyOf, signals: new RoiSignals() }) },
  };
  return { modules: [module] as const };
}
