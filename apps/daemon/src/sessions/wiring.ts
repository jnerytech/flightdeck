import type { SessionSummary } from "@flightdeck/protocol";
import { type Config, updateConfigFile } from "../config.ts";
import { SessionManager, type SessionManagerOptions, type TurnEdge } from "./session-manager.ts";
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
    commands: true as const,
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

/** The options the session manager takes as they are; the rest are built from the deps below. */
type PlainOptions = Omit<
  SessionManagerOptions,
  | "allowedRoots"
  | "defaultPermissionMode"
  | "allowApiKey"
  | "allowBypass"
  | "trust"
  | "prepareTrust"
  | "onActivity"
  | "keepAwake"
  | "onTurn"
  | "onTurnEdge"
>;

type TurnResult = Parameters<NonNullable<SessionManagerOptions["onTurn"]>>[2];

/** What the session manager is built from (issue #1593). */
export interface SessionManagerDeps extends PlainOptions {
  config: Pick<
    Config,
    "allowedRoots" | "defaultPermissionMode" | "allowApiKey" | "allowBypassPermissions"
  >;
  /** A folder's trust (issue #196). */
  projectTrust: {
    sessionTrust: NonNullable<SessionManagerOptions["trust"]>;
    prepare: NonNullable<SessionManagerOptions["prepareTrust"]>;
  };
  /** The host's keep-awake (#163), told how many sessions are active. */
  keepAwake: { update(active: number): void };
  /** A pinned session and a card's stay awake; filled in once the board and the meta exist. */
  awake: {
    pinned?: (claudeSessionId: string | null) => boolean;
    cardSession?: (sessionId: string) => boolean;
  };
  /** Phase 7's usage, counted on every turn. */
  usage: { record(sessionId: string, cwd: string, turn: TurnResult): void };
  /** Phase 34's account card; absent when the host reads no account. */
  account: { turnEnded(): void } | undefined;
  /** Phase 12's snapshots, taken at the start and end of every turn. */
  snapshots: {
    enqueue(input: Omit<TurnEdge, "sessionId">): void;
  };
}

/** The session manager, with the host's trust, keep-awake, usage and snapshots plugged in. */
export function createSessionManager({
  config,
  projectTrust,
  keepAwake,
  awake,
  usage,
  account,
  snapshots,
  ...plain
}: SessionManagerDeps) {
  return new SessionManager({
    ...plain,
    onActivity: (active) => keepAwake.update(active),
    trust: projectTrust.sessionTrust.bind(projectTrust),
    prepareTrust: projectTrust.prepare.bind(projectTrust),
    allowedRoots: config.allowedRoots,
    defaultPermissionMode: config.defaultPermissionMode,
    allowApiKey: config.allowApiKey,
    allowBypass: () => config.allowBypassPermissions,
    keepAwake: (session: SessionSummary) =>
      awake.pinned?.(session.claudeSessionId) === true || awake.cardSession?.(session.id) === true,
    onTurn: (sessionId, cwd, turn, runtime) => {
      usage.record(sessionId, cwd, turn);
      // The account card reads the Claude plan; an OpenCode turn spends none of it.
      if (runtime === "claude") account?.turnEnded();
    },
    onTurnEdge: (edge) =>
      snapshots.enqueue({
        cwd: edge.cwd,
        claudeSessionId: edge.claudeSessionId,
        kind: edge.kind,
        ...(edge.prompt !== undefined ? { prompt: edge.prompt } : {}),
        ...(edge.turnUuid !== undefined ? { turnUuid: edge.turnUuid } : {}),
      }),
  });
}
