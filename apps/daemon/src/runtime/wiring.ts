import { accountReaders, demoAccountReaders } from "../account/index.ts";
import type { RuntimeKind } from "../config.ts";
import { spawnExec } from "../kernel/index.ts";
import { claudeVersionProbe } from "./domain/claude-probe.ts";
import type { FlightdeckMcpServer } from "./domain/flightdeck-mcp.ts";
import { FakeRuntime } from "./fake-runtime.ts";
import type { AgentRuntime } from "./types.ts";

export interface CreatedRuntime {
  runtime: AgentRuntime;
  /** What `host.info` reports about `claude`; only the real runtime has one. */
  claude?: { path: string | null; version(): Promise<string | null> };
  /** What the account card reads (phase 34); the real runtime asks its `claude`, the fake one answers a demo account. */
  accountReaders?: ReturnType<typeof accountReaders>;
}

/** The engine the host runs: the fake one of the demo, or the real one over the Claude Agent SDK. */
export async function createRuntime(
  kind: RuntimeKind,
  claudePath?: string,
  mcpServer?: FlightdeckMcpServer,
): Promise<CreatedRuntime> {
  if (kind === "fake")
    return { runtime: new FakeRuntime(), accountReaders: demoAccountReaders(Date.now) };
  const { ClaudeSdkRuntime } = await import("./claude-sdk-runtime.ts");
  const runtime = new ClaudeSdkRuntime({
    ...(claudePath ? { claudePath } : {}),
    ...(mcpServer ? { mcpServer } : {}),
  });
  const path = runtime.claudePath ?? null;
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  return {
    runtime,
    claude: { path, version: claudeVersionProbe(path, spawnExec) },
    accountReaders: accountReaders({
      claudePath: path,
      exec: spawnExec,
      query: query as unknown as Parameters<typeof accountReaders>[0]["query"],
    }),
  };
}
