export type BrowserAttempt = { channel: "chrome" | "msedge" } | { executablePath: string };

/** The names of a distribution's Chromium, in the order they are tried. */
export const CHROMIUM_NAMES = ["chromium", "chromium-browser"];

export function browserAttempts(_which?: (name: string) => string | null): BrowserAttempt[] {
  return [];
}

export async function launchFirst<T>(
  _launch: (attempt: BrowserAttempt) => Promise<T>,
  _which?: (name: string) => string | null,
): Promise<T> {
  return undefined as T;
}
