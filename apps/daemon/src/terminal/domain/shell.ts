/**
 * The shell a terminal opens without a command, as an argv: on Windows `pwsh` when it exists,
 * else `powershell`; elsewhere `$SHELL`, else `bash`, else `sh`.
 */
export function defaultShell(opts: {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  which(name: string): string | null;
}): string[] {
  const { platform, env, which } = opts;
  if (platform === "win32") return [which("pwsh") ?? which("powershell") ?? "powershell.exe"];
  return [env.SHELL || which("bash") || which("sh") || "sh"];
}
