import type { Database } from "bun:sqlite";
import type { SshAuth, SshOptions, SshTarget } from "@flightdeck/protocol";
import { FlightdeckError } from "../errors.ts";
import { ulid } from "../ulid.ts";

export interface SshTargetsOptions {
  db: Database;
  now?: () => number;
}

/** What the form sends: everything but the id, timestamps and the pinned server key. */
export interface SshTargetInput {
  /** Present: edit that target. Absent: a new one. */
  id?: string;
  name: string;
  host: string;
  port?: number;
  user: string;
  viaHost?: string | null;
  auth?: SshAuth;
  secretRef?: string | null;
  jump?: string | null;
  options?: SshOptions;
  tags?: string[];
  /** Turning ForwardAgent on asks for an explicit yes. */
  confirm?: boolean;
}

interface Row {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  via_host: string | null;
  auth: SshAuth;
  secret_ref: string | null;
  jump: string | null;
  options: string;
  tags: string;
  host_key: string | null;
  created_at: string;
  updated_at: string;
}

// ssh reads a word that starts with "-" as an option, so no name that reaches its argv may.
const HOST = /^[A-Za-z0-9][A-Za-z0-9._-]{0,252}$/;
const IPV6 = /^[0-9A-Fa-f]*:[0-9A-Fa-f:.]{1,44}$/;
const USER = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/;
/** `[bind:]port:host:port`, kept as the text OpenSSH takes for LocalForward. */
const FORWARD = /^(?:[A-Za-z0-9.*-]+:)?(\d{1,5}):[A-Za-z0-9][A-Za-z0-9._-]*:(\d{1,5})$/;
const hasControl = (text: string) =>
  [...text].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
const MAX_TAGS = 20;

const badRequest = (
  message: string,
  reason: string,
  params: Record<string, string | number> = {},
) => new FlightdeckError("bad_request", message, reason, params);
const notFound = () =>
  new FlightdeckError("not_found", "destination not found", "ssh_target_not_found");
const validPort = (port: number) => Number.isInteger(port) && port >= 1 && port <= 65_535;

/** The ssh destinos registered on this host (phase 15): only references to secrets, never secrets. */
export class SshTargets {
  private readonly now: () => number;

  constructor(private readonly opts: SshTargetsOptions) {
    this.now = opts.now ?? Date.now;
  }

  list(): SshTarget[] {
    const rows = this.opts.db
      .query("SELECT * FROM ssh_targets ORDER BY name COLLATE NOCASE, id")
      .all() as Row[];
    return rows.map(toTarget);
  }

  get(id: string): SshTarget | null {
    const row = this.row(id);
    return row ? toTarget(row) : null;
  }

  save(input: SshTargetInput): SshTarget {
    const previous = input.id ? this.row(input.id) : null;
    if (input.id && !previous) throw notFound();
    const name = input.name.trim();
    if (name.length < 1 || name.length > 100) {
      throw badRequest("name takes 1 to 100 characters", "ssh_name_invalid");
    }
    if (input.host.length > 253 || !(HOST.test(input.host) || IPV6.test(input.host))) {
      throw badRequest("invalid host", "ssh_host_invalid");
    }
    if (!USER.test(input.user)) throw badRequest("invalid user", "ssh_user_invalid");
    const port = input.port ?? 22;
    if (!validPort(port)) throw badRequest("invalid port", "ssh_port_invalid");
    const auth = input.auth ?? "agent";
    const secretRef = this.secretRef(auth, input.secretRef);
    const jump = this.jump(input.jump ?? null, input.id);
    const options = this.options(input.options ?? {});
    const wasOn = previous
      ? (JSON.parse(previous.options) as SshOptions).forwardAgent === true
      : false;
    if (options.forwardAgent === true && !wasOn && input.confirm !== true) {
      throw new FlightdeckError(
        "invalid_state",
        "ForwardAgent hands your agent to the remote host: confirm with confirm: true",
        "ssh_forward_agent_confirm",
      );
    }
    const viaHost = input.viaHost?.trim() || null;
    const tags = this.tags(input.tags ?? []);
    const at = new Date(this.now()).toISOString();
    const id = previous?.id ?? ulid(this.now());
    // The pinned server key belongs to the host and port it was read from.
    const sameServer = previous?.host === input.host && previous.port === port;
    const hostKey = sameServer ? (previous?.host_key ?? null) : null;
    this.opts.db
      .query(
        `INSERT INTO ssh_targets (id, name, host, port, user, via_host, auth, secret_ref, jump,
                                  options, tags, host_key, created_at, updated_at)
         VALUES ($id, $name, $host, $port, $user, $via, $auth, $ref, $jump, $options, $tags,
                 $hostKey, $at, $at)
         ON CONFLICT (id) DO UPDATE SET name = $name, host = $host, port = $port, user = $user,
           via_host = $via, auth = $auth, secret_ref = $ref, jump = $jump, options = $options,
           tags = $tags, host_key = $hostKey, updated_at = $at`,
      )
      .run({
        $id: id,
        $name: name,
        $host: input.host,
        $port: port,
        $user: input.user,
        $via: viaHost,
        $auth: auth,
        $ref: secretRef,
        $jump: jump,
        $options: JSON.stringify(options),
        $tags: JSON.stringify(tags),
        $hostKey: hostKey,
        $at: at,
      });
    return toTarget(this.row(id) as Row);
  }

  /** The pinned server key: its fingerprint and every key (`<type> <base64>`), or none yet. */
  pinned(id: string): { fingerprint: string; keys: string[] } | null {
    const raw = this.row(id)?.host_key;
    return raw ? (JSON.parse(raw) as { fingerprint: string; keys: string[] }) : null;
  }

  pin(id: string, key: { fingerprint: string; keys: string[] }): SshTarget {
    return this.setHostKey(id, JSON.stringify(key));
  }

  unpin(id: string): SshTarget {
    return this.setHostKey(id, null);
  }

  private setHostKey(id: string, value: string | null): SshTarget {
    this.opts.db.query("UPDATE ssh_targets SET host_key = ? WHERE id = ?").run(value, id);
    return toTarget(this.row(id) as Row);
  }

  remove(id: string, confirm: boolean): void {
    if (!this.row(id)) throw notFound();
    if (!confirm) {
      throw new FlightdeckError(
        "invalid_state",
        "removing a destination needs confirm: true",
        "ssh_remove_confirm",
      );
    }
    const user = this.opts.db.query("SELECT name FROM ssh_targets WHERE jump = ?").get(id) as {
      name: string;
    } | null;
    if (user) {
      throw new FlightdeckError(
        "invalid_state",
        `"${user.name}" goes through this destination (jump)`,
        "ssh_jump_in_use",
        { name: user.name },
      );
    }
    this.opts.db.query("DELETE FROM ssh_targets WHERE id = ?").run(id);
  }

  private row(id: string): Row | null {
    return this.opts.db.query("SELECT * FROM ssh_targets WHERE id = ?").get(id) as Row | null;
  }

  /** The key file's path or the vault item; the agent has nothing to refer to. */
  private secretRef(auth: SshAuth, given: string | null | undefined): string | null {
    if (auth === "agent") return null;
    const ref = given?.trim() || null;
    if (ref === null) {
      if (auth === "password") return null;
      throw auth === "key-file"
        ? badRequest("give the path of the key", "ssh_key_path_needed")
        : badRequest("give the vault key", "ssh_vault_key_needed");
    }
    if (ref.length > 1024 || hasControl(ref) || (auth === "key-file" && ref.startsWith("-"))) {
      throw badRequest("invalid reference", "ssh_secret_ref_invalid");
    }
    return ref;
  }

  /** An existing target, not this one and not one that already goes through this one. */
  private jump(jump: string | null, ownId: string | undefined): string | null {
    if (jump === null) return null;
    if (!this.row(jump)) {
      throw badRequest("the jump must be a registered destination", "ssh_jump_unknown");
    }
    for (let at: string | null = jump; at; at = this.row(at)?.jump ?? null) {
      if (at === ownId) throw badRequest("the jump cannot form a cycle", "ssh_jump_cycle");
    }
    return jump;
  }

  private options(given: SshOptions): SshOptions {
    const out: SshOptions = {};
    const alive = given.serverAliveInterval;
    if (alive !== undefined) {
      if (!Number.isInteger(alive) || alive < 1 || alive > 3600) {
        throw badRequest("ServerAliveInterval from 1 to 3600", "ssh_alive_range");
      }
      out.serverAliveInterval = alive;
    }
    if (given.compression !== undefined) out.compression = given.compression;
    if (given.forwardAgent !== undefined) out.forwardAgent = given.forwardAgent;
    if (given.localForward !== undefined) {
      if (given.localForward.length > MAX_TAGS) {
        throw badRequest("too many LocalForward", "ssh_forward_too_many");
      }
      for (const forward of given.localForward) {
        const match = FORWARD.exec(forward);
        if (!match || !validPort(Number(match[1])) || !validPort(Number(match[2]))) {
          throw badRequest(`invalid LocalForward: ${forward.slice(0, 40)}`, "ssh_forward_invalid", {
            forward: forward.slice(0, 40),
          });
        }
      }
      out.localForward = [...given.localForward];
    }
    return out;
  }

  private tags(given: string[]): string[] {
    const tags = [...new Set(given.map((tag) => tag.trim()).filter((tag) => tag !== ""))];
    if (tags.length > MAX_TAGS) {
      throw badRequest(`at most ${MAX_TAGS} tags`, "ssh_too_many_tags", { max: MAX_TAGS });
    }
    for (const tag of tags) {
      if (tag.length > 40 || tag.includes(",") || hasControl(tag))
        throw badRequest("invalid tag", "ssh_tag_invalid");
    }
    return tags;
  }
}

function toTarget(row: Row): SshTarget {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    user: row.user,
    viaHost: row.via_host,
    auth: row.auth,
    secretRef: row.secret_ref,
    jump: row.jump,
    options: JSON.parse(row.options) as SshOptions,
    tags: JSON.parse(row.tags) as string[],
    // The column holds the fingerprint and the keys; the app only needs the fingerprint.
    hostKey: row.host_key
      ? (JSON.parse(row.host_key) as { fingerprint: string }).fingerprint
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
