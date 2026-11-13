/**
 * The program that holds the computer awake, as a process (#1612): the one place the power domain
 * launches `systemd-inhibit`, `caffeinate` or PowerShell from. The domain hands it a command line and
 * gets back something it can kill and wait for.
 */

/** A holder started as a child process of the daemon; null when it cannot start. */
export function spawnHolder(cmd: string[]): { kill(): void; exited: Promise<void> } | null {
  try {
    const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore", stdin: "ignore" });
    return {
      kill: () => proc.kill(),
      exited: proc.exited.then(() => undefined),
    };
  } catch {
    return null;
  }
}
