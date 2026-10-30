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
