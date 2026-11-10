// The Usage context: plan quota, the account, costs, budgets, return on cost and host resources (issue #1600: moved from index.ts).
import { z } from "zod";
import { cmd } from "./command.ts";

export const Usage = z.object({
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  cacheReadInputTokens: z.number().nonnegative().optional(),
  cacheCreationInputTokens: z.number().nonnegative().optional(),
});
export type Usage = z.infer<typeof Usage>;

/** Phase 36: one week of the ROI trend. Counts and the cost in US$ the agents spent; never a rate or a value. */
export interface RoiWeek {
  /** First day of the week (YYYY-MM-DD); the weeks end on the period's last day and go back by seven. */
  from: string;
  to: string;
  costUsd: number;
  tokens: number;
  cards: number;
  planned: number;
  unplanned: number;
  prsMerged: number;
}

/** Phase 36: what one project delivered, and cost, in a period. */
export interface RoiPeriod {
  costUsd: number;
  /** Input, output and cache tokens of the period. */
  tokens: number;
  /** Cards done, split into those already on the board when the period began and those created in it. */
  cards: number;
  planned: number;
  unplanned: number;
  prsMerged: number;
  plannedPrs: number;
  unplannedPrs: number;
  /** Done cards that came from an issue. */
  issuesResolved: number;
  /** PR-watch fix rounds of the cards done in the period, and what they cost. */
  fixRounds: number;
  fixCostUsd: number;
  /** Estimated hours of the done cards (the card's, else the project's default) and how many had none. */
  hours: number;
  cardsWithoutEstimate: number;
  /** Managed-session approvals resolved in the period, and how long they waited for the person. */
  decisions: number;
  waitedSeconds: number;
  /** Cost that belongs to no card of the project (a manual session in it). */
  outsideCardsUsd: number;
  /** The log was approximated for some of these cards (the date comes from their last update). */
  approxCards: number;
  /** The last eight weeks ending on the period's last day, oldest first. */
  weeks: RoiWeek[];
}

export interface RoiProject {
  projectKey: string;
  name: string;
  current: RoiPeriod;
  previous: RoiPeriod;
  /** The optional signals the project has on, for the asked period; absent when none is. */
  signals?: RoiSignalValues;
}

/** Phase 36: agent commits (approximate: counted by a trailer) and closed issues, or why not. */
export interface RoiSignalValues {
  agentCommits?: number;
  issuesClosed?: number;
  /** Why the closed issues are missing: `gh_missing`, `gh_logged_out` or `gh_failed`. */
  issuesError?: string;
}

export interface RoiSummaryResult {
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  projects: RoiProject[];
}

// Phase 7 (track B): the plan quota of a host, read from its managed sessions.
export const QuotaWindow = z.object({
  /** `five_hour`, `seven_day` or any other window the CLI reports. */
  window: z.string(),
  /** Fraction from 0 to 1; `null` when the CLI did not say. */
  utilization: z.number().nullable(),
  status: z.enum(["allowed", "allowed_warning", "rejected"]),
  resetsAt: z.string().nullable(),
  /** When this reading arrived: the app shows its age. */
  readAt: z.string(),
});
export type QuotaWindow = z.infer<typeof QuotaWindow>;

export const QuotaState = z.object({
  /** Valid readings only: one past its `resetsAt` is dropped until a new one comes. */
  windows: z.array(QuotaWindow),
  /** From this utilization new cards wait for the window to reset; `null` when off. */
  pauseAt: z.number().nullable(),
});
export type QuotaState = z.infer<typeof QuotaState>;

// Phase 34: the Claude account the host's own `claude` is signed in to (never a token).
export const AccountStatus = z.enum([
  "signed_in",
  "signed_out",
  "api_key",
  "third_party",
  "unknown",
]);
export type AccountStatus = z.infer<typeof AccountStatus>;

export const AccountState = z.object({
  status: AccountStatus,
  /** The account's email, shown as text in the card only; `null` when none is known. */
  name: z.string().nullable(),
  organization: z.string().nullable(),
  /** `pro`, `max`, `team`, `enterprise`, `free` or any other plan name the CLI reports. */
  plan: z.string().nullable(),
  /** `firstParty`, `bedrock`, ... as the CLI names it. */
  provider: z.string().nullable(),
  /** The plan windows now valid on the host, with the age of each reading. */
  windows: z.array(QuotaWindow),
  /** When the account was last read (ISO); `null` before the first read. */
  readAt: z.string().nullable(),
  /** The last read failed, so everything above is the previous reading. */
  stale: z.boolean(),
  /** Why the last read failed (`account_unavailable`), or `null`. */
  error: z.string().nullable(),
  /** `status` when only the CLI's status was read, `sdk` when the usage report was too. */
  source: z.enum(["status", "sdk"]),
  /** What the person runs on the host to sign in; the app shows it and never runs it for them. */
  loginCommand: z.literal("claude auth login"),
});
export type AccountState = z.infer<typeof AccountState>;

/** Sent after `account.watch` with the host's account after each read and each change of its windows. */
export const AccountUpdated = z.object({
  type: z.literal("account.updated"),
  ...AccountState.shape,
});
export type AccountUpdated = z.infer<typeof AccountUpdated>;

/** Usage of the host's managed sessions in one day (host time zone) and project. */
export const UsageRow = z.object({
  /** `YYYY-MM-DD`. */
  day: z.string(),
  projectKey: z.string(),
  /** What the SDK reports (an estimate on a subscription). */
  costUsd: z.number(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  turns: z.number().int(),
  /** How many of the turns ended in an error; absent from a daemon that does not count them. */
  failedTurns: z.number().int().optional(),
  /** The time the turns took, in milliseconds; absent from a daemon that does not add it up. */
  durationMs: z.number().optional(),
});
export type UsageRow = z.infer<typeof UsageRow>;

export const UsageSummary = z.object({
  days: z.number().int(),
  /** Newest day first, then by project. */
  rows: z.array(UsageRow),
});
export type UsageSummary = z.infer<typeof UsageSummary>;

// Phase 8 (track A): estimated costs, read from the transcripts of every session of the host.
export const UnpricedModel = z.object({
  model: z.string(),
  entries: z.number().int(),
  tokens: z.number().int(),
});
export type UnpricedModel = z.infer<typeof UnpricedModel>;

/** A managed session whose computed cost is far from the SDK's `total_cost_usd`. */
export const CostsDivergence = z.object({
  claudeSessionId: z.string(),
  /** The model with most of the session's cost. */
  model: z.string(),
  computedUsd: z.number(),
  sdkUsd: z.number(),
});
export type CostsDivergence = z.infer<typeof CostsDivergence>;

/** Phase 23: a terminal session whose cost in the OTLP telemetry and in the transcripts differ. */
export const TelemetryDivergence = z.object({
  claudeSessionId: z.string(),
  computedUsd: z.number(),
  telemetryUsd: z.number(),
});
export type TelemetryDivergence = z.infer<typeof TelemetryDivergence>;

/** Where the usage of a message came from; `subagent` keeps the parent session's id. */
/** `auto-approve` (phase 13): the automatic approval's own queries. */
export const UsageOrigin = z.enum([
  "terminal",
  "app",
  "card",
  "workflow",
  "subagent",
  "auto-approve",
  /** Phase 40: a call of the AI assistant. */
  "assistant",
]);
export type UsageOrigin = z.infer<typeof UsageOrigin>;

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dia em AAAA-MM-DD");

/** Days `from`..`to` (inclusive, host time zone) and optional filters. */
export const CostsFilter = z.object({
  from: Day,
  to: Day,
  projectKey: z.string().optional(),
  model: z.string().optional(),
  origin: UsageOrigin.optional(),
});
export type CostsFilter = z.infer<typeof CostsFilter>;

export const TokenCounts = z.object({
  input: z.number().int(),
  output: z.number().int(),
  cacheRead: z.number().int(),
  cacheWrite5m: z.number().int(),
  cacheWrite1h: z.number().int(),
});
export type TokenCounts = z.infer<typeof TokenCounts>;

export const CostsSummary = z.object({
  from: z.string(),
  to: z.string(),
  totals: z.object({
    /** Estimated, in API prices; messages of a model without a price count 0. */
    costUsd: z.number(),
    tokens: TokenCounts,
    /** What the cache reads cost less than the same tokens as plain input. */
    cacheSavingsUsd: z.number(),
    messages: z.number().int(),
    unpricedMessages: z.number().int(),
  }),
  /** By day, then project: the chart stacks the projects of each day. */
  byDay: z.array(
    z.object({ day: z.string(), projectKey: z.string(), costUsd: z.number(), tokens: z.number() }),
  ),
  byProject: z.array(z.object({ projectKey: z.string(), costUsd: z.number(), tokens: z.number() })),
  byModel: z.array(
    z.object({
      model: z.string(),
      costUsd: z.number(),
      tokens: z.number(),
      /** `false` for a model without a price: its tokens count, its cost does not. */
      priced: z.boolean(),
    }),
  ),
  byOrigin: z.array(z.object({ origin: UsageOrigin, costUsd: z.number(), tokens: z.number() })),
  /** By the persona the session opened with (else the one applied); `null` is no persona. */
  byPersona: z.array(
    z.object({ persona: z.string().nullable(), costUsd: z.number(), tokens: z.number() }),
  ),
  /** The 20 most expensive sessions, subagents included. */
  topSessions: z.array(
    z.object({
      claudeSessionId: z.string(),
      /** The managed session, when the app or a card ran it (opens it live). */
      sessionId: z.string().nullable(),
      projectKey: z.string(),
      title: z.string().nullable(),
      cwd: z.string().nullable(),
      costUsd: z.number(),
      tokens: z.number(),
    }),
  ),
});
export type CostsSummary = z.infer<typeof CostsSummary>;

export const CostsSession = z.object({
  claudeSessionId: z.string(),
  costUsd: z.number(),
  tokens: z.number(),
  /** The part of `costUsd` spent by the session's subagents. */
  subagentCostUsd: z.number(),
  byModel: z.array(z.object({ model: z.string(), costUsd: z.number(), tokens: z.number() })),
});
export type CostsSession = z.infer<typeof CostsSession>;

/** The readings of one quota window over the last hours, with where it is heading. */
export const QuotaHistory = z.object({
  window: z.string(),
  hours: z.number().int(),
  samples: z.array(
    z.object({
      utilization: z.number().nullable(),
      status: z.string(),
      resetsAt: z.string().nullable(),
      takenAt: z.string(),
    }),
  ),
  /** From 3 samples of the current window on (a linear fit); `null` before that. */
  projection: z
    .object({
      /** When the window reaches 100% at the current pace; `null` when not before it resets. */
      exhaustsAt: z.string().nullable(),
      resetsAt: z.string().nullable(),
      samples: z.number().int(),
    })
    .nullable(),
  /**
   * The 5-hour window only: each project's share of the estimated cost of the entries since the
   * window began (an approximation: the plan does not say who used it).
   */
  consumers: z.array(z.object({ projectKey: z.string(), costUsd: z.number(), share: z.number() })),
});
export type QuotaHistory = z.infer<typeof QuotaHistory>;

/** The periods of a budget: a day or month (host time zone), or a window of the plan quota. */
export const BudgetPeriod = z.enum(["day", "month", "five_hour", "seven_day"]);
export type BudgetPeriod = z.infer<typeof BudgetPeriod>;

/** A cost limit of the host or of one project, per day or month (host time zone). */
export const BudgetInput = z.object({
  /** Present to change an existing budget. */
  id: z.string().optional(),
  scope: z.enum(["host", "project"]),
  /** Required for `project`, ignored for `host`. */
  projectKey: z.string().min(1).optional(),
  period: z.enum(["day", "month"]),
  limitUsd: z.number().positive(),
  /** `queue`: at 100%, new cards of the scope wait (sessions are never held). */
  action: z.enum(["notify", "queue"]),
});
export type BudgetInput = z.infer<typeof BudgetInput>;

/**
 * A limit in terms of the plan quota instead of dollars (issue #1248): the share of a quota
 * window the host, or one project (an estimate), may use. The window is its period.
 */
export const QuotaBudgetInput = z.object({
  /** Present to change an existing budget. */
  id: z.string().optional(),
  scope: z.enum(["host", "project"]),
  /** Required for `project`, ignored for `host`. */
  projectKey: z.string().min(1).optional(),
  window: z.enum(["five_hour", "seven_day"]),
  /** The share of the window, from 0.1% up to 100%. */
  limitPct: z.number().min(0.001).max(1),
  /** `queue`: at 100% of the limit, new cards of the scope wait (sessions are never held). */
  action: z.enum(["notify", "queue"]),
});
export type QuotaBudgetInput = z.infer<typeof QuotaBudgetInput>;

export const Budget = z.object({
  id: z.string(),
  scope: z.enum(["host", "project"]),
  projectKey: z.string().nullable(),
  period: BudgetPeriod,
  /** 0 for a window budget. */
  limitUsd: z.number(),
  /** The share of the window a window budget allows; `null` for dollars. */
  limitPct: z.number().nullable().default(null),
  action: z.enum(["notify", "queue"]),
  createdAt: z.string(),
  /**
   * The current period: `YYYY-MM-DD` or `YYYY-MM`, or when the window resets (`unread` while the
   * host has no reading of it).
   */
  periodKey: z.string(),
  /** The estimated cost of the scope in the period (dollars, or the window so far). */
  spentUsd: z.number(),
  /** The share of the window the scope used; `null` for dollars. */
  spentPct: z.number().nullable().default(null),
  /** A project's share of a window is an estimate: the plan does not say who used it. */
  estimated: z.boolean().default(false),
  /** `spentUsd / limitUsd`, or `spentPct / limitPct` for a window. */
  fraction: z.number(),
  /** Thresholds (0.5, 0.8, 1) already crossed in this period. */
  crossed: z.array(z.number()),
});
export type Budget = z.infer<typeof Budget>;

export const CostsStatus = z.object({
  /** The first pass over the transcripts that already existed. */
  initialLoad: z.object({
    state: z.enum(["running", "done"]),
    filesDone: z.number().int(),
    filesTotal: z.number().int(),
  }),
  /** When the default price table was taken (`YYYY-MM-DD`). */
  pricingDate: z.string(),
  /** Models without a price: their tokens count, their cost does not. */
  unpriced: z.array(UnpricedModel),
  /** Over 10% and US$ 0.05 apart: the price table may be out of date. */
  divergences: z.array(CostsDivergence),
  /** Phase 23: the same check against the cost the sessions' telemetry reported. */
  telemetryDivergences: z.array(TelemetryDivergence).default([]),
});
export type CostsStatus = z.infer<typeof CostsStatus>;

/** One source of the context at the start of a session, with an estimate of its tokens. */
export const BudgetSource = z.object({
  kind: z.enum(["managed", "user", "project", "local", "rules", "skills", "memory"]),
  path: z.string(),
  bytes: z.number().int().nonnegative(),
  tokens: z.number().int().nonnegative(),
  /** `start` is in the context from the first message; `on-demand` only when Claude reads it. */
  load: z.enum(["start", "on-demand"]),
  note: z.string().optional(),
});
export type BudgetSource = z.infer<typeof BudgetSource>;

/**
 * Issue #154: what the host's work costs it. Executable names only: never a command line or an
 * environment, which can hold secrets.
 */
export const ResourceBytes = z.object({
  totalBytes: z.number().nonnegative(),
  freeBytes: z.number().nonnegative(),
});

export const ResourceRow = z.object({
  kind: z.enum(["session", "terminal"]),
  /** The session's or the terminal's id. */
  id: z.string(),
  name: z.string().nullable(),
  cwd: z.string().nullable(),
  /** Resident memory of the process tree, in bytes. */
  rssBytes: z.number().nonnegative(),
  /** CPU of the tree since the last snapshot, in % of one core; null on the first reading. */
  cpuPercent: z.number().nonnegative().nullable(),
  processes: z.number().int().nonnegative(),
  /** Executable names, once each. */
  names: z.array(z.string()),
});

export const ResourceOrphan = z.object({
  pid: z.number().int().positive(),
  name: z.string(),
  rssBytes: z.number().nonnegative(),
  ageSec: z.number().nonnegative(),
  /** When it started, in clock ticks after the boot: with the pid it names this very process. */
  startTicks: z.number().int().nonnegative(),
});

export const ResourcesSnapshot = z.object({
  at: z.string(),
  memory: ResourceBytes,
  disk: ResourceBytes.nullable(),
  /** One-minute load average divided by the number of cores, in %; null where there is none. */
  loadPercent: z.number().nonnegative().nullable(),
  /** Whether the processes were measured; false says why in `reason`. */
  measured: z.boolean(),
  reason: z.enum(["platform"]).nullable(),
  rows: z.array(ResourceRow),
  orphans: z.array(ResourceOrphan),
  /** Issue #1343: the share of used memory from which new cards wait; null when off, absent on older hosts. */
  memoryPauseAt: z.number().min(0).max(1).nullable().optional(),
  /**
   * Issue #1414: whether the memory hold keeps new cards waiting now, by the host's own gate (its
   * release margin, and never where the host has no reading, as on macOS); absent on older hosts.
   */
  memoryHolding: z.boolean().optional(),
});
export type ResourcesSnapshot = z.infer<typeof ResourcesSnapshot>;

export type ResourceRow = z.infer<typeof ResourceRow>;
export type ResourceOrphan = z.infer<typeof ResourceOrphan>;

/** Sent after `quota.watch` with the host's windows after each new reading or expiry. */
export const QuotaUpdated = z.object({ type: z.literal("quota.updated"), ...QuotaState.shape });
export type QuotaUpdated = z.infer<typeof QuotaUpdated>;

/** Sent after `budget.watch`: a budget changed, crossed a threshold or entered a new period. */
export const BudgetUpdated = z.object({
  type: z.literal("budget.updated"),
  budget: Budget,
  /** The highest threshold just crossed (0.5, 0.8 or 1); `null` for other changes. */
  threshold: z.number().nullable(),
  removed: z.boolean(),
});
export type BudgetUpdated = z.infer<typeof BudgetUpdated>;

/** The usage commands; index.ts spreads them into `Command`. */
export const usageCommands = [
  /** Issue #154: one snapshot of the host's memory, disk and what each session and terminal costs. */
  cmd("resources.get", z.object({}).strict()),
  /** Issue #1343: from this share of used memory (0 to 1) on, new cards wait; null turns it off. */
  cmd("resources.setPauseAt", z.object({ pauseAt: z.number().min(0).max(1).nullable() }).strict()),
  /** Ends a process the snapshot lists as an orphan; the daemon checks again that it is one. */
  cmd(
    "resources.endOrphan",
    z
      .object({ pid: z.number().int().positive(), startTicks: z.number().int().nonnegative() })
      .strict(),
  ),
  // Phase 7 (track B).
  cmd("quota.get", z.object({}).strict()),
  cmd("quota.watch", z.object({}).strict()),
  /** The guard "new cards wait from N%": 0 to 1, `null` turns it off. Answers with the new state. */
  cmd("quota.setPauseAt", z.object({ pauseAt: z.number().min(0).max(1).nullable() }).strict()),
  cmd("account.get", z.object({}).strict()),
  cmd("account.watch", z.object({}).strict()),
  cmd("account.unwatch", z.object({}).strict()),
  cmd("account.refresh", z.object({}).strict()),
  cmd("usage.summary", z.object({ days: z.number().int().min(1).max(90).optional() })),
  // Phase 8 (track A).
  cmd("costs.status", z.object({}).strict()),
  cmd("costs.reprice", z.object({}).strict()),
  cmd("costs.summary", CostsFilter),
  cmd("costs.session", z.object({ claudeSessionId: z.string() })),
  cmd("costs.sessions", z.object({ claudeSessionIds: z.array(z.string()).max(500) })),
  cmd("costs.card", z.object({ cardId: z.string() })),
  cmd("costs.run", z.object({ runId: z.string() })),
  cmd("costs.export", CostsFilter),
  cmd("budget.list", z.object({}).strict()),
  cmd("budget.set", BudgetInput),
  cmd("budget.setQuota", QuotaBudgetInput),
  cmd("budget.remove", z.object({ id: z.string() })),
  /** `budget.updated` after each change, threshold crossed or new period. */
  cmd("budget.watch", z.object({}).strict()),
  cmd(
    "quota.history",
    z.object({ window: z.string().min(1), hours: z.number().int().min(1).max(720) }),
  ),
  /** The data of `flightdeckd statusline`: quota windows, today's cost and the session's. */
  cmd("statusline.get", z.object({ claudeSessionId: z.string().optional() })),
  /** Phase 36: what the agents cost and delivered, per project key, for a period and the one before it. */
  cmd(
    "roi.summary",
    z
      .object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        projectKey: z.string().min(1).max(500).optional(),
      })
      .strict(),
  ),
] as const;

/** The `data` of each usage command's ack; `CommandResults` extends it. */
export interface UsageResults {
  "resources.get": ResourcesSnapshot;
  "resources.setPauseAt": { pauseAt: number | null };
  "resources.endOrphan": { ended: true };
  "quota.get": QuotaState;
  "quota.watch": undefined;
  "quota.setPauseAt": QuotaState;
  "account.get": AccountState;
  "account.watch": undefined;
  "account.unwatch": undefined;
  "account.refresh": AccountState;
  "usage.summary": UsageSummary;
  "costs.status": CostsStatus;
  "costs.reprice": { entries: number };
  "costs.summary": CostsSummary;
  "costs.session": CostsSession;
  /** Only the sessions that have entries. */
  "costs.sessions": { costs: Record<string, number> };
  "costs.card": { costUsd: number };
  "costs.run": { costUsd: number };
  "costs.export": { csv: string; filename: string };
  "budget.list": { budgets: Budget[] };
  "budget.set": Budget;
  "budget.setQuota": Budget;
  "budget.remove": undefined;
  "budget.watch": undefined;
  "quota.history": QuotaHistory;
  "statusline.get": {
    windows: Array<{ window: string; utilization: number | null }>;
    todayUsd: number;
    sessionUsd: number | null;
  };
  "roi.summary": RoiSummaryResult;
}
