import { join } from "node:path";

/** The `~/.ssh/config` the demo's hosts read for Connections > Import (#3945). */
export function writeDemoSshConfig(home: string): string {
  return join(home, ".ssh", "config");
}
