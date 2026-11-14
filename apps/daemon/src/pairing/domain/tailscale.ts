/**
 * The address `tailscale ip -4` printed: its first line, or `null` when the command failed or
 * printed none. The command runs at the edge; this reads its result.
 */
export function tailscaleAddress(result: { code: number; stdout: string }): string | null {
  return result.code === 0 ? result.stdout.trim().split("\n")[0] || null : null;
}
