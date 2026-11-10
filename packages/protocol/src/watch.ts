// Watch and fix: a card's PR is watched and the rounds that fix what got worse, with the checks they may run and their trace (issue #1600: moved from index.ts).
import { z } from "zod";
import { cmd } from "./command.ts";
import { TraceSessionInfo } from "./trace.ts";

/**
 * Phase 22: a local check of the PR watch runs unattended after a fixing round, so it is a command
 * and its arguments separated by spaces, with nothing a shell would read: no quotes, pipes,
 * redirections, substitutions, variables, globs or line breaks.
 */
export const isWatchCheck = (line: string): boolean =>
  /^[\w@+=:,./-]+(?: [\w@+=:,./-]+)*$/.test(line);

/**
 * Issue #1361: the names a project may add to its checks' environment: where a toolchain lives
 * (`JAVA_HOME`, `ANDROID_SDK_ROOT`, `GOPATH`), never a variable that runs or redirects code. An
 * allowlist: a blocklist of the variables that steer code (`GIT_SSH_COMMAND`, `JAVA_TOOL_OPTIONS`,
 * `npm_config_*`, `RUSTC_WRAPPER`, …) would never be complete.
 */
const TOOLCHAIN_ENV =
  /^(?:[A-Z][A-Z0-9_]*_(?:HOME|ROOT)|GOPATH|GOROOT|GOCACHE|GOMODCACHE|BUN_INSTALL|NVM_DIR|DENO_DIR|PUB_CACHE|ProgramFiles\(x86\)|CommonProgramFiles(?:\(x86\))?)$/i;

/**
 * Issue #1361: refused even when shaped like a location: a secret's name (connection strings, key
 * files, tokens), Flightdeck's own, git's and npm's, or a loader's. Over-blocking is fine: a check
 * that needs a secret does not run unattended. Any case (Windows reads both).
 */
const REFUSED_ENV = [
  /TOKEN|KEY|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|SESSION|JWT/i,
  /BEARER|SAS|SIGNATURE|WEBHOOK|DSN|DATABASE_URL|CONN|PRIVATE|CERT/i,
  // Today no name that passes TOOLCHAIN_ENV ends this way; kept, as the one pattern had them.
  /_PASS$|^PWD$|_PAT$/i,
  /^(?:ANTHROPIC|CLAUDE|OPENAI|AWS|AZURE|GH|GITHUB|FLIGHTDECK|GIT|NPM|LD|DYLD|XDG)_/i,
];

/** Issue #1361: a name a project may add to its checks' environment (the value stays the daemon's). */
export const isCheckEnvName = (name: string): boolean =>
  TOOLCHAIN_ENV.test(name) && !REFUSED_ENV.some((refused) => refused.test(name));

/** Phase 22: how a card's PR is watched and fixed, per project. */
export const WatchSettings = z.object({
  enabled: z.boolean(),
  /** Rounds of fixing per PR. */
  maxRounds: z.number().int().min(1).max(10),
  /** Commands that must pass in the card's worktree before anything is pushed. */
  checks: z
    .array(
      z
        .string()
        .min(1)
        .max(400)
        .refine(isWatchCheck, "a check is a command and its arguments, with nothing a shell reads"),
    )
    .max(10),
  /** Minutes each local check gets before it is killed. */
  checkTimeoutMin: z.number().int().min(1).max(60),
  /** Estimated cost of the rounds of a PR, in US$; `null` for no limit. */
  budgetUsd: z.number().positive().nullable(),
  maxTurns: z.number().int().positive().nullable(),
  persona: z.string().min(1).max(40),
  /** Rounds in a row that fail before the card asks for you. */
  maxFailures: z.number().int().min(1).max(10),
  /** Cost of every round of the project in a day, in US$; `null` for no limit. */
  dailyUsd: z.number().positive().nullable(),
  /** Issue #1361: rounds of the check loop per turn of the person; absent from older daemons. */
  checkRounds: z.number().int().min(1).max(10).optional(),
  /** Issue #1361: names added to the checks' allowlisted environment. */
  checkEnv: z
    .array(
      z.string().max(64).refine(isCheckEnvName, "a variable name, not one shaped like a secret"),
    )
    .max(20)
    .optional(),
  /** Issue #1361: new cards in bypassPermissions start with the check loop on. */
  checkLoopDefault: z.boolean().optional(),
  /** Issue #77: globs of files a round may change outside its PR (lockfiles); absent from older daemons. */
  driftAllow: z
    .array(
      z
        .string()
        .min(1)
        .max(200)
        .regex(/^[^\p{Cc}]+$/u, "a glob has no control characters"),
    )
    .max(50)
    .optional(),
});
export type WatchSettings = z.infer<typeof WatchSettings>;

export const FixRoundInfo = z.object({
  id: z.string(),
  cardId: z.string(),
  n: z.number().int(),
  /** `held`: the round drifted from its PR (#77): its commits wait for you to push or drop them. */
  status: z.enum(["running", "pushed", "failed", "stopped", "held"]),
  trigger: z.object({
    failed: z.array(z.string()),
    conflicts: z.boolean(),
    comments: z.array(z.string()),
  }),
  summary: z.string().nullable(),
  sessionId: z.string().nullable(),
  costUsd: z.number(),
  turns: z.number().int(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  /** A held round's files outside the PR and its churn against the limit (#77). */
  drift: z
    .object({ outside: z.array(z.string()), churn: z.number().int(), limit: z.number().int() })
    .nullable()
    .optional(),
});
export type FixRoundInfo = z.infer<typeof FixRoundInfo>;

/** What the app shows of a card's watch. */
export const WatchInfo = z.object({
  cardId: z.string(),
  enabled: z.boolean(),
  /** `needs_you`: a limit was hit or a round failed for good; `reason` says which. */
  status: z.enum(["watching", "needs_you"]),
  reason: z.string().nullable(),
  rounds: z.array(FixRoundInfo),
  /** Issue #77: the rounds that count against the limit, and the limit with the rounds allowed on top. Absent from older daemons. */
  roundsUsed: z.number().int().min(0).optional(),
  maxRounds: z.number().int().min(1).optional(),
});
export type WatchInfo = z.infer<typeof WatchInfo>;

export const WatchUpdatedFrame = z.object({ type: z.literal("watch.updated"), watch: WatchInfo });
export type WatchUpdatedFrame = z.infer<typeof WatchUpdatedFrame>;

/** The trail from a card and its PR to its sessions, cost, rounds and work item. */
export const CardTraceInfo = z.object({
  cardId: z.string(),
  title: z.string(),
  prUrl: z.string().nullable(),
  workItem: z.string().nullable(),
  sessions: z.array(TraceSessionInfo),
  rounds: z.array(FixRoundInfo),
  costUsd: z.number().nullable(),
});
export type CardTraceInfo = z.infer<typeof CardTraceInfo>;

export const UrlTraceInfo = z.object({
  via: z.enum(["card", "history", "none"]),
  trace: CardTraceInfo.nullable(),
  sessions: z.array(
    z.object({ claudeSessionId: z.string(), title: z.string().nullable(), cwd: z.string() }),
  ),
});
export type UrlTraceInfo = z.infer<typeof UrlTraceInfo>;

/** The watch commands; index.ts spreads them into `Command`. */
export const watchCommands = [
  /** Phase 22: the PR watch of a project (the settings) and of a card (the switch, the rounds). */
  cmd(
    "watch.settings",
    z.object({ projectId: z.string().min(1), patch: WatchSettings.partial().strict().optional() }),
  ),
  cmd("watch.set", z.object({ cardId: z.string().min(1), enabled: z.boolean().nullable() })),
  cmd("watch.get", z.object({ cardId: z.string().min(1) })),
  // Issue #77: the person allows a card N more fixing rounds; the card is watched again.
  cmd(
    "watch.extend",
    z.object({ cardId: z.string().min(1), rounds: z.number().int().min(1).max(10) }).strict(),
  ),
  // Issue #77: the person pushes a held round as it is, or drops its commits.
  cmd(
    "watch.resolveHeld",
    z
      .object({
        cardId: z.string().min(1),
        roundId: z.string().min(1),
        action: z.enum(["push", "drop"]),
      })
      .strict(),
  ),
  cmd("watch.trace", z.object({ cardId: z.string().min(1) })),
  /** The PR description made from the card's sessions, for the person to edit: nothing is opened. */
  cmd("watch.describe", z.object({ cardId: z.string().min(1) })),
  cmd("watch.byUrl", z.object({ url: z.string().min(1).max(2000) })),
  cmd("watch.watch", z.object({}).strict()),
] as const;

/** The `data` of each watch command's ack; `CommandResults` extends it. */
export interface WatchResults {
  "watch.settings": WatchSettings;
  "watch.set": WatchInfo;
  "watch.get": WatchInfo;
  "watch.extend": WatchInfo;
  "watch.resolveHeld": WatchInfo;
  "watch.trace": CardTraceInfo;
  "watch.describe": { text: string; redacted: number };
  "watch.byUrl": UrlTraceInfo;
  "watch.watch": undefined;
}
