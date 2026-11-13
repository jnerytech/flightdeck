import type { ChecksState } from "@flightdeck/protocol";
import { FlightdeckError } from "../kernel/index.ts";
import type { PrCheck } from "./port.ts";

/**
 * A name taken from a PR URL, before it goes into a CLI argument. `az` replaces an argument that
 * starts with @ (and every `name=@file`) by the content of that file, and `gh api -F name=@file`
 * does the same: a repository or project called "@..." would make the CLI read a local file and
 * send it away. A line break has no place in a name either.
 */
export function urlName(what: string, value: string): string {
  const control = [...value].some((char) => (char.codePointAt(0) ?? 0) < 32);
  if (value === "" || value.startsWith("@") || control) {
    throw new FlightdeckError(
      "invalid_state",
      `invalid ${what} in the PR URL: ${JSON.stringify(value)}`,
      "pr_url_part_invalid",
      { what, value },
    );
  }
  return value;
}

/** Worst check wins: any failure fails, anything unfinished is pending; no checks, `null`. */
export function summarize(results: Array<"passing" | "failing" | "pending">): ChecksState | null {
  if (results.length === 0) return null;
  if (results.includes("failing")) return "failing";
  return results.includes("pending") ? "pending" : "passing";
}

/** What a build log keeps in all: the end of the logs of what failed. */
export const BUILD_LOG_BYTES = 16 * 1024;

/** The last `limit` bytes of a text, with a mark when something was left out. */
export function tail(text: string, limit: number): string {
  const bytes = Buffer.from(text);
  if (bytes.length <= limit) return text;
  return `[…]\n${bytes
    .subarray(bytes.length - limit)
    .toString("utf8")
    .replace(/^\uFFFD+/, "")}`;
}
