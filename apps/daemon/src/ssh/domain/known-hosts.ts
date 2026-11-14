/**
 * The server keys of an ssh destino as rules (phase 15): which lines of `ssh-keyscan` count, in
 * what order, the fingerprint shown to the user and the Flightdeck's own known_hosts lines.
 */
import { createHash } from "node:crypto";

/** The fingerprint shown to the user comes from the first of these a server offers. */
const KEY_TYPES = [
  "ssh-ed25519",
  "ecdsa-sha2-nistp256",
  "ecdsa-sha2-nistp384",
  "ecdsa-sha2-nistp521",
  "ssh-rsa",
];
const KEY_LINE = new RegExp(
  String.raw`^\S+\s+(${KEY_TYPES.join("|")})\s+([A-Za-z0-9+/]+={0,2})\s*$`,
);
/** The keys `ssh-keyscan` printed, as `<type> <base64>`, most preferred type first. */
export function keyscanKeys(stdout: string): string[] {
  const found = new Map<string, string>();
  for (const line of stdout.split(/\r?\n/)) {
    const match = KEY_LINE.exec(line);
    if (match) found.set(`${match[1]} ${match[2]}`, match[1] as string);
  }
  return [...found.entries()]
    .sort((a, b) => KEY_TYPES.indexOf(a[1]) - KEY_TYPES.indexOf(b[1]))
    .map(([key]) => key);
}

/** The SHA256 fingerprint, as `ssh-keygen -l` prints it. */
export function fingerprintOf(key: string): string {
  const blob = Buffer.from(key.split(" ")[1] as string, "base64");
  return `SHA256:${createHash("sha256").update(blob).digest("base64").replace(/=+$/, "")}`; // NOSONAR: a SHA-256 digest in base64 is 44 chars with one "="
}

/** The lines of the Flightdeck's own known_hosts for a server: `host key`, or `[host]:port key`. */
export function knownHostsLines(host: string, port: number, keys: string[]): string[] {
  const pattern = port === 22 ? host : `[${host}]:${port}`;
  return keys.map((key) => `${pattern} ${key}`);
}
