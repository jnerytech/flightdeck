import type { Database } from "bun:sqlite";
import type { DomainModule } from "../server/index.ts";
import { Names } from "./names.ts";

/** Phase 21: the standard name of every session of this host, as the module the server takes `names` from. */
export function createNames(db: Database) {
  const names = new Names(db);
  const module: DomainModule<"names"> = { server: { names } };
  return { modules: [module] as const, names };
}
