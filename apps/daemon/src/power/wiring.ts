import { type Config, updateConfigFile } from "../config.ts";
import { whichOnPath } from "../kernel/index.ts";
import type { DomainModule } from "../server/index.ts";
import { detectWsl, realWslProbe } from "../wsl/index.ts";
import { spawnHolder } from "./adapters/holder.ts";
import { KeepAwake, type PowerContext } from "./domain/keep-awake.ts";

export function osPowerContext(): PowerContext {
  // The test suite sets the service guard: a daemon a test starts holds nothing, as if no
  // inhibitor could start; only the keep-awake tests pass their own context or call spawnHolder.
  const guarded = Boolean(process.env.FLIGHTDECK_SERVICE_GUARD);
  return {
    platform: process.platform,
    pid: process.pid,
    wsl: detectWsl(realWslProbe) !== null,
    which: whichOnPath,
    hold: guarded ? () => null : spawnHolder,
  };
}

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
