import type { HostInfoResult } from "@flightdeck/protocol";

/** What to open: a folder, and the session to resume there when there is one. */
export interface TerminalTarget {
  cwd: string;
  claudeSessionId: string | null;
}

/** This machine: Windows, and whether Windows Terminal (`wt.exe`) is installed. */
export interface TerminalEnv {
  windows: boolean;
  wt: boolean;
}

/** A program run with its arguments as a list, or a command for the user to paste. */
export type TerminalLaunch =
  | { kind: "spawn"; program: string; args: string[] }
  | { kind: "copy"; text: string };

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** The daemon listens on this machine (a WSL distro's too, through localhost forwarding). */
export function isLocalUrl(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** POSIX shell quoting, only when the word needs it. */
const shQuote = (word: string) =>
  /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;

/** cmd.exe quoting, only when the word has a space. */
const cmdQuote = (word: string) => (/\s/.test(word) ? `"${word}"` : word);

/**
 * How "Abrir no terminal" opens `target`. A host on this Windows machine runs its stable
 * `flightdeckd` (or the PATH one) in Windows Terminal, or through `cmd /k` without it; a supervised
 * WSL distro goes through `wsl.exe`. Anything else gets the command to copy.
 */
export function terminalLaunch(
  host: { url: string; hostInfo: HostInfoResult | null },
  target: TerminalTarget,
  env: TerminalEnv | null,
): TerminalLaunch {
  const info = host.hostInfo;
  const fd = info?.flightdeckdPath ?? "flightdeckd";
  const resume = target.claudeSessionId ? ["--resume", target.claudeSessionId] : [];
  const claude = [fd, "claude", ...resume];
  const here = env?.windows === true && info !== null && isLocalUrl(host.url);
  if (here && info.os === "win32") {
    return env.wt
      ? { kind: "spawn", program: "wt.exe", args: ["-d", target.cwd, ...claude] }
      : {
          kind: "spawn",
          program: "cmd.exe",
          args: ["/c", "start", "", "/d", target.cwd, "cmd", "/k", ...claude],
        };
  }
  if (here && info.os === "linux" && info.wslDistro) {
    const wsl = ["wsl.exe", "-d", info.wslDistro, "--cd", target.cwd, "--", ...claude];
    return env.wt
      ? { kind: "spawn", program: "wt.exe", args: wsl }
      : { kind: "spawn", program: "cmd.exe", args: ["/c", "start", "", ...wsl] };
  }
  const rest = ["claude", ...resume].join(" ");
  const text =
    info?.os === "win32"
      ? `cd /d ${cmdQuote(target.cwd)} && ${cmdQuote(fd)} ${rest}`
      : `cd ${shQuote(target.cwd)} && ${shQuote(fd)} ${rest}`;
  return { kind: "copy", text };
}
