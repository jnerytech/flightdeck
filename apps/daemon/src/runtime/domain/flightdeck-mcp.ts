/** The Flightdeck MCP server a managed session gets, so a team's tools need no manual `claude mcp add`. */
export interface FlightdeckMcpServer {
  command: string;
  args: string[];
}

/** `flightdeckd mcp` for this daemon: the same binary (or `bun run <main>`) and the same config file. */
export function flightdeckMcpServer(self: string[], configFile: string): FlightdeckMcpServer {
  const [command = "", ...rest] = self;
  return { command, args: [...rest, "mcp", "--config", configFile] };
}
