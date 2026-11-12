import type { Database } from "bun:sqlite";
import { type Config, updateConfigFile } from "../config.ts";
import { type DomainModule, serverGroup } from "../server/index.ts";
import { QuotaHistory } from "./history.ts";
import { Quota } from "./quota.ts";
import { UsageLedger, type UsageLedgerOptions } from "./usage.ts";

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
  const quotaPause = {
    set: async (pauseAt: number | null) => {
      // The file first: when it cannot be written the guard stays as it was, for the client and the daemon.
      await updateConfigFile(configFile, (raw) => ({
        ...raw,
        quota: { ...(raw.quota as object | undefined), pauseAt },
      }));
      config.quota.pauseAt = pauseAt;
      quota.setPauseAt(pauseAt);
    },
  };
  const module: DomainModule<"quota"> = {
    server: {
      quota: serverGroup<"quota">()({ windows: quota, pause: quotaPause, history: quotaHistory }),
    },
    stop: () => quota.stop(),
    // It stops after the server today (#2094).
    stopPhase: "late",
  };
  return {
    modules: [module] as const,
    quota,
    /** A session's quota readings: the guard and the history both take them. */
    onQuota: (readings: Parameters<Quota["record"]>[0]) => {
      quota.record(readings);
      quotaHistory.sample(readings);
    },
  };
}

/** The cost and tokens of every turn, as the module the server takes `usage` from. */
export function createUsage(options: UsageLedgerOptions) {
  const usage = new UsageLedger(options);
  const module: DomainModule<"usage"> = { server: { usage } };
  return { modules: [module] as const, usage };
}
