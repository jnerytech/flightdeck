/** What tells a process it runs inside WSL: its environment and `/proc/version`. */
export interface WslProbe {
  env: Record<string, string | undefined>;
  /** The text of `/proc/version`, or null when it cannot be read. */
  procVersion(): string | null;
}

/** Where this host runs inside WSL: the distro name (null when unknown), or null outside WSL. */
export function detectWsl(probe: WslProbe): { distro: string | null } | null {
  const distro = probe.env.WSL_DISTRO_NAME;
  if (distro) return { distro };
  return /microsoft/i.test(probe.procVersion() ?? "") ? { distro: null } : null;
}

/** The host name for a machine name: the machine's, and inside WSL "<machine> (WSL <distro>)". */
export function hostNameIn(machine: string, probe: WslProbe): string {
  const wsl = detectWsl(probe);
  if (!wsl) return machine;
  return `${machine} (WSL${wsl.distro ? " " + wsl.distro : ""})`;
}

/** Ports of a daemon in WSL are the Windows daemon's plus this, so both can run side by side. */
export const WSL_PORT_OFFSET = 10;
