import { createHash } from "node:crypto";
import type { SshHostKeyCheck, SshTarget } from "@flightdeck/protocol";
import { FlightdeckError } from "../errors.ts";
import { type Exec, spawnExec } from "../exec.ts";
import type { SshTargets } from "./targets.ts";

export interface HostKeysOptions {
  targets: SshTargets;
  /** Runs `ssh-keyscan`; the real process by default. */
  exec?: Exec;
  now?: () => number;
}

/** The fingerprint shown to the user comes from the first of these a server offers. */
const KEY_TYPES = [
  "ssh-ed25519",
  "ecdsa-sha2-nistp256",
  "ecdsa-sha2-nistp384",
  "ecdsa-sha2-nistp521",
  "ssh-rsa",
];
const KEY_LINE = new RegExp(`^\\S+\\s+(${KEY_TYPES.join("|")})\\s+([A-Za-z0-9+/]+={0,2})\\s*$`);
/** What was shown stays confirmable this long. */
const PENDING_MS = 5 * 60_000;

/** ssh-keyscan could not read the server keys (unreachable from here, or nothing answered). */
export class ScanFailed extends FlightdeckError {
  constructor(message: string) {
    super("invalid_state", message);
    this.name = "ScanFailed";
  }
}

interface Scan {
  fingerprint: string;
  /** `<type> <base64>`, most preferred type first. */
  keys: string[];
}

/** The SHA256 fingerprint, as `ssh-keygen -l` prints it. */
function fingerprintOf(key: string): string {
  const blob = Buffer.from(key.split(" ")[1] as string, "base64");
  return `SHA256:${createHash("sha256").update(blob).digest("base64").replace(/=+$/, "")}`;
}

/** The lines of the Flightdeck's own known_hosts for a server: `host key`, or `[host]:port key`. */
export function knownHostsLines(host: string, port: number, keys: string[]): string[] {
  const pattern = port === 22 ? host : `[${host}]:${port}`;
  return keys.map((key) => `${pattern} ${key}`);
}

/**
 * The server keys of the ssh destinos (phase 15). The first time, `ssh-keyscan` reads the keys
 * and the app shows the fingerprint; only that fingerprint, confirmed, pins them. After that a
 * different key blocks, showing the old and the new fingerprint, until the pin is forgotten.
 */
export class HostKeys {
  private readonly exec: Exec;
  private readonly now: () => number;
  private readonly pending = new Map<string, { scan: Scan; at: number }>();

  constructor(private readonly opts: HostKeysOptions) {
    this.exec = opts.exec ?? spawnExec;
    this.now = opts.now ?? Date.now;
  }

  async check(targetId: string): Promise<SshHostKeyCheck> {
    const target = this.target(targetId);
    const scan = await this.scan(target.host, target.port);
    const pinned = this.opts.targets.pinned(targetId);
    this.pending.set(targetId, { scan, at: this.now() });
    if (!pinned) return { status: "unknown", fingerprint: scan.fingerprint, pinned: null };
    const same = pinned.keys.every((key) => scan.keys.includes(key));
    return {
      status: same ? "pinned" : "changed",
      fingerprint: scan.fingerprint,
      pinned: pinned.fingerprint,
    };
  }

  /** Pins the keys of the last check, if `fingerprint` is the one that check showed. */
  confirm(targetId: string, fingerprint: string): SshTarget {
    this.target(targetId);
    if (this.opts.targets.pinned(targetId)) {
      throw new FlightdeckError(
        "invalid_state",
        "a server key is already pinned: forget it before replacing it",
        "ssh_hostkey_exists",
      );
    }
    const shown = this.pending.get(targetId);
    if (!shown || this.now() - shown.at > PENDING_MS || shown.scan.fingerprint !== fingerprint) {
      throw new FlightdeckError(
        "invalid_state",
        "confirm the fingerprint that was just shown: check again",
        "ssh_hostkey_mismatch",
      );
    }
    this.pending.delete(targetId);
    return this.opts.targets.pin(targetId, shown.scan);
  }

  forget(targetId: string): SshTarget {
    this.target(targetId);
    this.pending.delete(targetId);
    return this.opts.targets.unpin(targetId);
  }

  private target(id: string): SshTarget {
    const target = this.opts.targets.get(id);
    if (!target) {
      throw new FlightdeckError("not_found", "destination not found", "ssh_target_not_found");
    }
    return target;
  }

  private async scan(host: string, port: number): Promise<Scan> {
    const { code, stdout } = await this.exec([
      "ssh-keyscan",
      "-T",
      "5",
      "-t",
      "ed25519,ecdsa,rsa",
      "-p",
      String(port),
      "--",
      host,
    ]);
    const found = new Map<string, string>();
    for (const line of stdout.split(/\r?\n/)) {
      const match = KEY_LINE.exec(line);
      if (match) found.set(`${match[1]} ${match[2]}`, match[1] as string);
    }
    const keys = [...found.entries()]
      .sort((a, b) => KEY_TYPES.indexOf(a[1]) - KEY_TYPES.indexOf(b[1]))
      .map(([key]) => key);
    if (code !== 0 || keys.length === 0) {
      throw new ScanFailed(`não consegui ler a chave do servidor (ssh-keyscan ${host}:${port})`);
    }
    return { fingerprint: fingerprintOf(keys[0] as string), keys };
  }
}
