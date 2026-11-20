import { UsageIndexer } from "../../src/costs/usage-indexer.ts";
import {
  type AutoApproveRequest,
  AutoApprover,
  type AutoApproveSettings,
} from "../../src/permissions/auto-approve.ts";
import type { RiskLevel } from "../../src/permissions/domain/risk.ts";
import { FakeRuntime } from "../../src/runtime/fake-runtime.ts";
import type { JudgeOptions, JudgeResult } from "../../src/runtime/types.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { tempDir } from "../support/helpers.ts";

export const TOKEN = "auto-token-0123456789abcdef";
export const ON: AutoApproveSettings = {
  enabled: true,
  model: "claude-haiku-5-5",
  lowWithoutAi: true,
};
export const TOKENS = {
  model: "claude-haiku-5-5",
  speed: "standard",
  input: 300,
  output: 20,
  cacheRead: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
};

export const cleanups: Array<() => unknown> = [];
export async function teardown() {
  for (const fn of cleanups.splice(0).reverse()) await fn();
}

/** An approver over a project at `cwd`, with a fake AI answering `judge`. */
export function setup(
  opts: {
    settings?: AutoApproveSettings;
    judge?: (o: JudgeOptions) => JudgeResult | Promise<JudgeResult>;
    timeoutMs?: number;
  } = {},
) {
  const cwd = tempDir("fd-auto-");
  const store = new EventStore(":memory:");
  cleanups.push(() => store.close());
  const runtime = new FakeRuntime({
    judge: opts.judge ?? (() => ({ decision: "allow", reason: "claramente seguro" })),
  });
  const dataDir = tempDir("fd-data-");
  const usage = new UsageIndexer({
    db: store.db,
    roots: [],
    projectKey: () => "github.com/acme/app",
  });
  const auto = new AutoApprover({
    db: store.db,
    runtime,
    dataDir,
    context: (dir) =>
      dir === cwd
        ? { projectId: "p1", settings: opts.settings ?? ON, description: "corrigir o login" }
        : null,
    ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
    usage,
  });
  const request = (
    toolName: string,
    input: Record<string, unknown>,
    level: RiskLevel,
    network = false,
    sessionKey = "s1",
  ): AutoApproveRequest => ({
    sessionKey,
    requestId: `r-${toolName}`,
    toolName,
    input,
    cwd,
    risk: { level, reason: "regra", network },
  });
  return { cwd, store, runtime, dataDir, auto, request };
}
