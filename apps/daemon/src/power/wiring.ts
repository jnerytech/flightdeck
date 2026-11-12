import { type Config, updateConfigFile } from "../config.ts";
import type { DomainModule } from "../server/index.ts";
import { KeepAwake, osPowerContext, type PowerContext } from "./keep-awake.ts";

/** What keeps the computer awake is built from. */
export interface PowerDeps {
  /** What keeps the computer awake (issue #163); the machine's own when absent. */
  powerContext?: PowerContext;
  config: Pick<Config, "keepAwake">;
  configFile: string;
}

/**
 * The host's hold on the computer (issue #163, #1593): awake while a session runs or waits for a
 * permission, and the switch the client turns, kept in the config.
 */
export function createKeepAwake({ powerContext, config, configFile }: PowerDeps) {
  const keepAwake = new KeepAwake(powerContext ?? osPowerContext(), config.keepAwake);
  const module: DomainModule<"keepAwake"> = {
    server: {
      /** The client's switch: the status, and a change written to the config file first. */
      keepAwake: {
        status: () => keepAwake.status(),
        set: async (enabled: boolean) => {
          // The file first: when it cannot be written the switch stays as it was, for the client and the daemon.
          await updateConfigFile(configFile, (raw) => ({ ...raw, keepAwake: enabled }));
          config.keepAwake = enabled;
          keepAwake.setEnabled(enabled);
        },
      },
    },
    stop: () => keepAwake.stop(),
    // First: whatever stops slowly after must not keep the computer awake meanwhile.
    stopPhase: "first",
  };
  return { modules: [module] as const, keepAwake };
}
