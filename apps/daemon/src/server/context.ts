/**
 * Issue #248: what every handler shares, built once by `startServer`: its options, the session
 * manager, and the feature gates. The view helpers several domains use move here with the first
 * domain that needs them.
 */
import type { SessionLine } from "@flightdeck/protocol";
import { type LiveState, sessionLine } from "../history/session-line.ts";
import type { ServerOptions } from "../server-options.ts";
import type { SessionManager } from "../sessions/session-manager.ts";
import { featuresOf } from "./features.ts";
import {
  type GatedGroup,
  type GatedOption,
  type GroupKey,
  type GroupService,
  need,
  needIn,
} from "./gates.ts";

export interface ServerContext {
  opts: ServerOptions;
  manager: SessionManager;
  /** When the server started, in ms: `host.info` reports the uptime from it. */
  startedAt: number;
  /** The features this daemon announces, read once at start (`host.info` adds the live ones). */
  features: string[];
  /** The service behind a gated option, or the `feature_off` refusal. */
  need<K extends GatedOption>(key: K): NonNullable<ServerOptions[K]>;
  /** The service of an option grouped by domain (#1593), or the `feature_off` refusal. */
  needIn<G extends GatedGroup, K extends GroupKey<G>>(group: G, key: K): GroupService<G, K>;
  /** A registered project's folder, by its id (the board must be on). */
  projectPath(projectId: string): string;
  /** Phase 8: a session's line from its transcript and live state; null without the index. */
  line(claudeSessionId: string | null, live: LiveState): SessionLine | null;
  /**
   * Asks git for the project key of each folder without blocking, so a sync list reads the cache:
   * a cold folder would otherwise cost one blocking git spawn on the event loop, which on Windows
   * is slow enough to time the list out.
   */
  warmKeys(cwds: string[]): Promise<void>;
}

export function serverContext(opts: ServerOptions): ServerContext {
  return {
    opts,
    manager: opts.manager,
    startedAt: Date.now(),
    features: featuresOf(opts),
    need: (key) => need(opts, key),
    needIn: (group, key) => needIn(opts, group, key),
    projectPath: (projectId) => need(opts, "board").getProject(projectId).path,
    line: (claudeSessionId, live) => {
      if (!opts.history) return null;
      return sessionLine(claudeSessionId ? opts.history.lastActivity(claudeSessionId) : null, live);
    },
    warmKeys: async (cwds) => {
      const warm = opts.projects?.warmKey;
      if (!opts.central || !warm) return;
      await Promise.all([...new Set(cwds)].map((cwd) => warm(cwd)));
    },
  };
}
