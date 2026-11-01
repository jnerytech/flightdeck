import { whichOnPath } from "../../apps/daemon/src/which.ts";

export type BrowserAttempt = { channel: "chrome" | "msedge" } | { executablePath: string };

/** The names of a distribution's Chromium, in the order they are tried. */
export const CHROMIUM_NAMES = ["chromium", "chromium-browser"];

/**
 * How to start a browser, best first: the installed Chrome, Edge when Chrome refuses automation
 * (some managed installs do), and the distribution's Chromium, the only one on Linux arm64.
 */
export function browserAttempts(which: (name: string) => string | null = whichOnPath) {
  const attempts: BrowserAttempt[] = [{ channel: "chrome" }, { channel: "msedge" }];
  for (const name of CHROMIUM_NAMES) {
    const executablePath = which(name);
    if (executablePath) {
      attempts.push({ executablePath });
      break;
    }
  }
  return attempts;
}

/** Launches with the first attempt that works; when none does, the error lists every reason. */
export async function launchFirst<T>(
  launch: (attempt: BrowserAttempt) => Promise<T>,
  which: (name: string) => string | null = whichOnPath,
): Promise<T> {
  const reasons: string[] = [];
  for (const attempt of browserAttempts(which)) {
    try {
      return await launch(attempt);
    } catch (error) {
      reasons.push((error as Error).message);
    }
  }
  throw new Error(reasons.join("; "));
}

/** Executables the e2e runner looks for on a Linux or macOS PATH, best first. */
export const RUNNER_BROWSER_NAMES = [
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
];

/**
 * The browser the e2e runner (`@playwright/test`, under Node) starts: the first system Chrome or
 * Chromium found, else the installed Chrome by channel (Windows). A channel cannot be probed
 * without launching, so on Windows the known install paths are checked as files: Chrome by channel, else Edge by
 * path. No browser is ever downloaded.
 */
const CHROME_FILE = "Google\\Chrome\\Application\\chrome.exe";
const EDGE_FILE = "Microsoft\\Edge\\Application\\msedge.exe";

export interface BrowserHost {
  env: Record<string, string | undefined>;
  platform: string;
  isFile: (path: string) => boolean;
}

export function browserLaunch(
  which: (name: string) => string | null,
  host?: BrowserHost,
): { executablePath: string } | { channel: "chrome" } {
  for (const name of RUNNER_BROWSER_NAMES) {
    const executablePath = which(name);
    if (executablePath) return { executablePath };
  }
  if (host?.platform === "win32") {
    const under = (suffix: string) =>
      ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"]
        .map((name) => host.env[name])
        .filter((dir): dir is string => Boolean(dir))
        .map((dir) => `${dir}\\${suffix}`);
    if (under(CHROME_FILE).some(host.isFile)) return { channel: "chrome" };
    const edge = under(EDGE_FILE).find(host.isFile);
    if (edge) return { executablePath: edge };
  }
  return { channel: "chrome" };
}

/** `which` for Node, which has no `Bun.which`: scans the PATH (and PATHEXT on Windows). */
export function whichOnNodePath(
  name: string,
  env: Record<string, string | undefined>,
  platform: string,
  isFile: (path: string) => boolean,
): string | null {
  const windows = platform === "win32";
  const sep = windows ? ";" : ":";
  const extensions = windows
    ? ["", ...(env.PATHEXT ?? ".EXE;.CMD").toLowerCase().split(";")]
    : [""];
  for (const dir of (env.PATH ?? "").split(sep).filter(Boolean)) {
    for (const ext of extensions) {
      const candidate = `${dir}${windows ? "\\" : "/"}${name}${ext}`;
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}
