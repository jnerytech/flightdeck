/**
 * Issue #1612: an anti-corruption layer per external system. A process the daemon launches
 * (`Bun.spawn`, `Bun.spawnSync`) belongs in the adapter folder of the system it runs (git, gh, the
 * claude CLI, ssh, systemd), so the domain code never sees a command line or an output format.
 * spawn-count-baseline.json holds how many launches each file outside an `adapters/` folder still
 * has and only goes down (`overBaseline` of the layout ratchet); the moves come one system per PR.
 */

/** Whether the check reads this tracked path: source under a package's src; stub, not decided yet. */
export function isScanned(_path: string): boolean {
  return false;
}

/** The scanned files that launch a process, with how many launches each holds; stub. */
export function spawnCounts(_files: { path: string; text: string }[]): Record<string, number> {
  return {};
}
