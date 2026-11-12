import type { DomainModule } from "../server/index.ts";
import { Central, type CentralOptions } from "./central.ts";

/**
 * The terminal sessions seen through Claude Code's hooks, as the module the server takes `central`
 * from. `main.ts` still waits for `central.ready()` and stops it in its own place in the shutdown.
 */
export function createCentral(options: CentralOptions) {
  const central = new Central(options);
  const module: DomainModule<"central"> = { server: { central } };
  return { modules: [module] as const, central };
}
