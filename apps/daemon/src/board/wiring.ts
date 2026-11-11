import { type Config, updateConfigFile } from "../config.ts";
import { HostPause } from "./host-pause.ts";

/** What the host's pause of new card runs is built from. */
export interface HostPauseDeps {
  config: Pick<Config, "pauseNewRuns">;
  configFile: string;
  /** What still runs, as the auto update's idle check counts it. */
  running: () => number;
}

/**
 * Issue #1404 (issue #1593): the person's pause of new card runs, kept in the config, and the
 * `host.pause` service that reads and sets it.
 */
export function createHostPause({ config, configFile, running }: HostPauseDeps) {
  const hostPause = new HostPause(config.pauseNewRuns);
  const server = {
    status: () => ({ paused: hostPause.paused(), running: running() }),
    set: async (paused: boolean) => {
      // The file first: when it cannot be written the pause stays as it was, for the client and the daemon.
      await updateConfigFile(configFile, (raw) => ({ ...raw, pauseNewRuns: paused }));
      config.pauseNewRuns = paused;
      hostPause.set(paused);
    },
  };
  return { hostPause, server };
}
