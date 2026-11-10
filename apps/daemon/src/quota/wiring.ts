import type { Database } from "bun:sqlite";
import { type Config, updateConfigFile } from "../config.ts";
import { QuotaHistory } from "./history.ts";
import { Quota } from "./quota.ts";

/** What the plan quota of the host is built from. */
export interface QuotaDeps {
  db: Database;
  config: Pick<Config, "quota">;
  configFile: string;
}

/**
 * The plan quota of the host (phase 7, issue #1593): the guard every managed session feeds, its
 * history, and the pause the client sets.
 */
export function createQuota({ db, config, configFile }: QuotaDeps) {
  const quota = new Quota({ pauseAt: config.quota.pauseAt });
  const quotaHistory = new QuotaHistory({ db });
  return {
    quota,
    quotaHistory,
    /** A session's quota readings: the guard and the history both take them. */
    onQuota: (readings: Parameters<Quota["record"]>[0]) => {
      quota.record(readings);
      quotaHistory.sample(readings);
    },
    quotaPause: {
      set: async (pauseAt: number | null) => {
        // The file first: when it cannot be written the guard stays as it was, for the client and the daemon.
        await updateConfigFile(configFile, (raw) => ({
          ...raw,
          quota: { ...(raw.quota as object | undefined), pauseAt },
        }));
        config.quota.pauseAt = pauseAt;
        quota.setPauseAt(pauseAt);
      },
    },
  };
}
