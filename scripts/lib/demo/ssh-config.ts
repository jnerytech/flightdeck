import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The `~/.ssh/config` the demo's hosts read for Connections > Import (#3945). Their daemons run as the
 * machine's user, so without this file the import would list the names of the runner's own config. One
 * name per language run, each with a host of its own: the two runs share the daemons, and a name that
 * shared a host with another would count as "already saved" once the other was imported.
 */
const CONFIG = ["en", "pt-br"]
  .map((lang) => `Host lab-${lang}\n  HostName lab-${lang}.example.test\n  User ops\n`)
  .join("\n");

export function writeDemoSshConfig(home: string): string {
  const dir = join(home, ".ssh");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, "config");
  writeFileSync(path, CONFIG, { mode: 0o600 });
  // `mode` is cut by the umask and ignored for a file that exists.
  chmodSync(path, 0o600);
  return path;
}
