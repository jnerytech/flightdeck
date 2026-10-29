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

const badRequest = (message: string) => new FlightdeckError("bad_request", message);
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
    if (input.id && !previous) throw new FlightdeckError("not_found", "destino não encontrado");
    const name = input.name.trim();
    if (name.length < 1 || name.length > 100) throw badRequest("nome de 1 a 100 caracteres");
    if (input.host.length > 253 || !(HOST.test(input.host) || IPV6.test(input.host))) {
      throw badRequest("host inválido");
    }
    if (!USER.test(input.user)) throw badRequest("usuário inválido");
    const port = input.port ?? 22;
    if (!validPort(port)) throw badRequest("porta inválida");
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
        "ForwardAgent entrega o seu agent ao host remoto: confirme com confirm: true",
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

  remove(id: string, confirm: boolean): void {
    if (!this.row(id)) throw new FlightdeckError("not_found", "destino não encontrado");
    if (!confirm) {
      throw new FlightdeckError("invalid_state", "remover um destino pede confirm: true");
    }
    const user = this.opts.db.query("SELECT name FROM ssh_targets WHERE jump = ?").get(id) as {
      name: string;
    } | null;
    if (user) {
      throw new FlightdeckError("invalid_state", `"${user.name}" passa por este destino (jump)`);
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
      throw badRequest(
        auth === "key-file" ? "informe o caminho da chave" : "informe a chave do cofre",
      );
    }
    if (ref.length > 1024 || hasControl(ref) || (auth === "key-file" && ref.startsWith("-"))) {
      throw badRequest("referência inválida");
    }
    return ref;
  }

  /** An existing target, not this one and not one that already goes through this one. */
  private jump(jump: string | null, ownId: string | undefined): string | null {
    if (jump === null) return null;
    if (!this.row(jump)) throw badRequest("o jump precisa ser um destino cadastrado");
    for (let at: string | null = jump; at; at = this.row(at)?.jump ?? null) {
      if (at === ownId) throw badRequest("o jump não pode formar um ciclo");
    }
    return jump;
  }

  private options(given: SshOptions): SshOptions {
    const out: SshOptions = {};
    const alive = given.serverAliveInterval;
    if (alive !== undefined) {
      if (!Number.isInteger(alive) || alive < 1 || alive > 3600) {
        throw badRequest("ServerAliveInterval de 1 a 3600");
      }
      out.serverAliveInterval = alive;
    }
    if (given.compression !== undefined) out.compression = given.compression;
    if (given.forwardAgent !== undefined) out.forwardAgent = given.forwardAgent;
    if (given.localForward !== undefined) {
      if (given.localForward.length > MAX_TAGS) throw badRequest("LocalForward demais");
      for (const forward of given.localForward) {
        const match = FORWARD.exec(forward);
        if (!match || !validPort(Number(match[1])) || !validPort(Number(match[2]))) {
          throw badRequest(`LocalForward inválido: ${forward.slice(0, 40)}`);
        }
      }
      out.localForward = [...given.localForward];
    }
    return out;
  }

  private tags(given: string[]): string[] {
    const tags = [...new Set(given.map((tag) => tag.trim()).filter((tag) => tag !== ""))];
    if (tags.length > MAX_TAGS) throw badRequest(`no máximo ${MAX_TAGS} tags`);
    for (const tag of tags) {
      if (tag.length > 40 || tag.includes(",") || hasControl(tag)) throw badRequest("tag inválida");
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
