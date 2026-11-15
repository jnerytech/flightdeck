import type { SpawnedAcp } from "../../src/runtime/acp/client.ts";
import {
  OpenCodeRuntime,
  type OpenCodeRuntimeOptions,
} from "../../src/runtime/opencode-runtime.ts";
import type { AgentRun, RuntimeEvent, StartOptions } from "../../src/runtime/types.ts";
import { FakeAcpAgent, manualTimers } from "./fake-acp-agent.ts";

export function setup(
  configure?: (agent: FakeAcpAgent) => void,
  over: Partial<OpenCodeRuntimeOptions> = {},
) {
  const agents: FakeAcpAgent[] = [];
  const timers = manualTimers();
  const killed: Array<[number, boolean]> = [];
  const checks: string[] = [];
  const runtime = new OpenCodeRuntime({
    path: "/bin/opencode",
    version: "2.2.5",
    preflight: {
      check: async (cwd) => {
        checks.push(cwd);
        return { configContent: '{"doc":1}' };
      },
    },
    scan: async () => ({ findings: [], fingerprint: "fp" }),
    spawn: (argv, opts) => {
      const agent = new FakeAcpAgent(argv, opts, 4242 + agents.length);
      configure?.(agent);
      agents.push(agent);
      return agent.transport();
    },
    kill: (child: SpawnedAcp, force: boolean) => {
      killed.push([child.pid, force]);
      child.kill();
    },
    timers,
    mcpServer: { command: "/bin/flightdeckd", args: ["mcp"] },
    ...over,
  });
  return { runtime, agents, timers, killed, checks };
}

export const startOpts = (over: Partial<StartOptions> = {}): StartOptions => ({
  cwd: "/w",
  permissionMode: "default",
  env: { HOME: "/h", FLIGHTDECK_SESSION: "fd1", OPENCODE_DB: "/x" },
  canUseTool: async () => ({ behavior: "allow" }),
  ...over,
});

export function collect(run: AgentRun) {
  const out = { events: [] as RuntimeEvent[], error: null as unknown, ended: false };
  void (async () => {
    try {
      for await (const event of run.events) out.events.push(event);
      out.ended = true;
    } catch (error) {
      out.error = error;
    }
  })();
  return out;
}
