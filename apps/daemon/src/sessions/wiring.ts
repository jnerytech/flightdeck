import { type Config, updateConfigFile } from "../config.ts";
import { IdleSleeper, type SleeperOptions } from "./sleeper.ts";
import { type StallOptions, StallWatcher } from "./stall.ts";

/** What the sessions' idle sleep, stall watch and bypass switch are built from. */
export interface SessionSettingsDeps {
  manager: SleeperOptions["manager"] & StallOptions["host"];
  config: Pick<Config, "allowBypassPermissions" | "sessions" | "stall">;
  configFile: string;
  /** The length of a stall "minute" when the demo and the journeys shorten it. */
  stallUnitMs: number | undefined;
}

/**
 * Issue #1593: the host's session settings, each kept in the config: idle sessions give back their
 * process after N minutes (#157), a quiet running session is marked (#1478), and the switch for
 * sessions without permission prompts. Both timers are off at 0 (no timer then).
 */
export function createSessionSettings({
  manager,
  config,
  configFile,
  stallUnitMs,
}: SessionSettingsDeps) {
  // Idle sessions give back their process after N minutes (off by default: no timer then).
  const sleeper = new IdleSleeper({ manager, minutes: config.sessions.sleepAfterMinutes });
  // A running session that says nothing for N minutes is marked quiet (0: off, no timer then).
  const stall = new StallWatcher({
    host: manager,
    minutes: config.stall.afterMinutes,
    ...(stallUnitMs !== undefined ? { unitMs: stallUnitMs } : {}),
  });
  const server = {
    bypass: {
      allowed: () => config.allowBypassPermissions,
      set: async (allow: boolean) => {
        config.allowBypassPermissions = allow;
        await updateConfigFile(configFile, (raw) => ({ ...raw, allowBypassPermissions: allow }));
      },
    },
    stall: { minutes: () => stall.minutes() },
    sleep: {
      minutes: () => sleeper.minutes(),
      set: async (minutes: number) => {
        sleeper.setMinutes(minutes);
        await updateConfigFile(configFile, (raw) => ({
          ...raw,
          sessions: { ...(raw.sessions as object | undefined), sleepAfterMinutes: minutes },
        }));
      },
    },
  };
  return { sleeper, stall, server };
}
