/**
 * What a `flightdeckd` command that asks the local daemon says and refuses (issues #1507, #3424): the
 * result a command returns (exit code, stdout lines, stderr lines), the rules for printing it, and the
 * check that the address of the config is this machine's. Each command keeps its own words and its own
 * calls; the timer and the connection are in `cli.ts`.
 */
import { WS_PATH } from "@flightdeck/protocol";

/** Exit codes of these commands: 0 done, 1 refused, 2 no daemon. */
export interface CliResult {
  code: 0 | 1 | 2;
  out: string[];
  err: string[];
  /** A stable word for a refusal a script may branch on (`--json`, issue #3429); absent for the rest. */
  reason?: string;
}

/** The address of this machine only: the token of the config is never sent anywhere else. */
export function isLoopbackHost(host: string): boolean {
  const name = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (name === "localhost" || name === "::1") return true;
  const octets = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(name);
  return octets?.slice(1).every((octet) => Number(octet) <= 255) ?? false;
}

export class TimedOut extends Error {}

/** A name or a text comes from the board, an issue, a session or the daemon: it may not drive the terminal or reorder what it reads. */
const CONTROL =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching these characters is the point
  // biome-ignore lint/suspicious/noMisleadingCharacterClass: each one is replaced on its own, never matched as a sequence
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\u061c\u00ad\u034f\u180e\ufe00-\ufe0f\ufeff\ufff9-\ufffb\u{e0000}-\u{e007f}]/gu;
const plain = (text: string) => text.replace(CONTROL, " ");

export const json = (value: unknown): CliResult => ({
  code: 0,
  // JSON leaves DEL and the C1 characters raw; its own line breaks are the only ones kept.
  out: [
    JSON.stringify(value, null, 2)
      .split("\n")
      .map((line) => plain(line))
      .join("\n"),
  ],
  err: [],
});
export const said = (...out: string[]): CliResult => ({
  code: 0,
  out: out.map(plain),
  err: [],
});

export const failure = (code: 1 | 2, message: string, reason?: string): CliResult => ({
  code,
  out: [],
  err: [plain(message)],
  ...(reason === undefined ? {} : { reason }),
});

/** Why this command will not talk to the address of the config, or null when it is the local daemon. */
export function addressRefusal(
  config: { bind: string; port: number },
  url: string,
): CliResult | null {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return failure(1, `${config.bind} is not a valid address for the daemon`);
  }
  // The address, and nothing else the bind could smuggle into the URL (a user, a query, another path).
  const portOk = target.port === String(config.port) || (config.port === 80 && target.port === "");
  const plain =
    portOk &&
    target.pathname === WS_PATH &&
    target.username === "" &&
    target.search === "" &&
    target.hash === "";
  if (isLoopbackHost(target.hostname) && plain) return null;
  return failure(
    1,
    `refusing to talk to ${target.hostname}: this command reaches only a daemon on the loopback (127.0.0.1 or ::1)`,
  );
}
