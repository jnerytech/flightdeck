import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { ClaudeSdkRuntime, type QueryFn } from "../../src/runtime/claude-sdk-runtime.ts";
import type { FlightdeckMcpServer } from "../../src/runtime/domain/flightdeck-mcp.ts";

/** Starts a run and returns the options the SDK would have received. */
export function startedWith(
  mcpServer: FlightdeckMcpServer | undefined,
  permissionMode: "default" | "acceptEdits" | "plan",
  sessionId: string | null = "s1",
): Options {
  let captured: Options | undefined;
  const query: QueryFn = (params) => {
    captured = params.options as Options;
    return {
      async *[Symbol.asyncIterator]() {
        yield {
          type: "system",
          subtype: "init",
          session_id: "c1",
          model: "m",
          tools: [],
        } as never as SDKMessage;
      },
      interrupt: async () => {},
      close: () => {},
    };
  };
  new ClaudeSdkRuntime({ query, ...(mcpServer ? { mcpServer } : {}) }).start({
    cwd: "/proj",
    permissionMode,
    env: { PATH: "/bin", ...(sessionId === null ? {} : { FLIGHTDECK_SESSION: sessionId }) },
    canUseTool: async () => ({ behavior: "allow" }),
  });
  return captured as Options;
}
