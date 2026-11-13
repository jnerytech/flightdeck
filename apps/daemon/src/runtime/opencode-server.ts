import type { DomainModule } from "../server/index.ts";
import type { CreatedOpenCode } from "./opencode-wiring.ts";

/**
 * The module the server takes `opencode` from (#2175): whether OpenCode runs here, and its models.
 * `models()` fails when OpenCode is off, as it always did: the app asks only after `info()` says it
 * runs. Kept out of `opencode-wiring.ts`, which the runtime's index exports: the server's types
 * reach back into the runtime.
 */
export function createOpenCodeServer(opencode: CreatedOpenCode) {
  const module: DomainModule<"opencode"> = {
    server: {
      opencode: {
        info: () => opencode.info,
        models: () => (opencode.models as NonNullable<CreatedOpenCode["models"]>)(),
      },
    },
  };
  return { modules: [module] as const };
}
