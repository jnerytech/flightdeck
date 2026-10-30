import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SshTarget, TerminalInfo } from "@flightdeck/protocol";
import { envInput, remoteCommand } from "../actions/ssh-command.ts";
import { FlightdeckError } from "../errors.ts";
import type { Timers } from "../quota/quota.ts";
import type { TerminalManager } from "../terminal/terminal-manager.ts";
import { type HostKeys, knownHostsLines, ScanFailed } from "./hostkey.ts";
import type { DeliveredKey, KeyDelivery } from "./key-delivery.ts";
import type { SshTargets } from "./targets.ts";

/** Runs ssh without a terminal (the connection test) and returns its stderr. */
export type RunSsh = (
  argv: string[],
  env: Record<string, string>,
) => Promise<{ code: number; stderr: string }>;

type SpawnRun = (
  cmd: string[],
  options: {
    env: Record<string, string | undefined>;
    stdin: "ignore";
    stdout: "ignore";
    stderr: "pipe";
  },
) => { stderr: ReadableStream<Uint8Array>; exited: Promise<number> };

export function processRun(spawn: SpawnRun = Bun.spawn as unknown as SpawnRun): RunSsh {
  return async (argv, env) => {
    const proc = spawn(argv, {
      env: { ...process.env, ...env },
      stdin: "ignore",
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    return { code, stderr };
  };
}

/** Phase 17: runs ssh for an action, writing `input` to its stdin and keeping what it prints. */
export type ExecSsh = (
  argv: string[],
  env: Record<string, string>,
  input: string,
  timeoutMs: number,
) => Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }>;

export function processExec(): ExecSsh {
  return async (argv, env, input, timeoutMs) => {
    const proc = Bun.spawn(argv, {
      env: { ...process.env, ...env },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeoutMs);
    proc.stdin.write(input);
    await proc.stdin.end();
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    clearTimeout(timer);
    return { code, stdout, stderr, timedOut };
  };
}

/**
 * The `ssh` to run. On Windows the OpenSSH of the system, which is the one that takes `NUL` and
 * `-F`, when it exists; otherwise whatever the PATH finds.
 */
export function resolveSshPath(opts: {
  platform: NodeJS.Platform;
  exists: (path: string) => boolean;
  which: (name: string) => string | null;
}): string {
  if (opts.platform === "win32") {
    const system = `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\OpenSSH\\ssh.exe`;
    if (opts.exists(system)) return system;
  }
  return opts.which("ssh") ?? "ssh";
}

/** What the daemon hands to the askpass helper of ssh (the `askpass` area fills it in). */
export interface AskpassHook {
  /** The program `SSH_ASKPASS` points to. */
  script: string;
  /** The daemon's config, so the helper finds the daemon. */
  configFile: string;
  /** A one-use ticket naming what ssh is going to ask for. Never the password itself. */
  ticket(target: SshTarget, kind: "password" | "passphrase"): string;
}

export interface SshConnectorOptions {
  targets: SshTargets;
  hostKeys: Pick<HostKeys, "check">;
  terminals: Pick<TerminalManager, "open">;
  /** The daemon's own folder for the files ssh reads (config, known_hosts). */
  dir: string;
  platform?: NodeJS.Platform;
  sshPath: string;
  delivery: KeyDelivery;
  askpass?: AskpassHook;
  run: RunSsh;
  /** Phase 17: how an `ssh:` action's ssh runs. */
  exec?: ExecSsh;
  timers?: Timers;
}

/** The key is taken away this long after the connection started, whatever else happens. */
const DELIVERY_MS = 60_000;

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** A terminal for the person, a reachability test, or an `ssh:` action (phase 17). */
type Mode = "connect" | "test" | "exec";

interface Plan {
  argv: string[];
  env: Record<string, string>;
  /** The undo that fires after 60 s. */
  timer?: unknown;
  /** Idempotent: takes the delivered key away and forgets the timer. */
  release(): void;
}

/** What ssh printed, in words for the person. */
function translate(stderr: string, code: number): string {
  if (/Permission denied/i.test(stderr)) return "autenticação recusada";
  if (/Connection refused/i.test(stderr)) return "conexão recusada";
  if (/Could not resolve hostname/i.test(stderr)) return "host não encontrado";
  if (/timed out/i.test(stderr)) return "tempo esgotado";
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(stderr)) {
    return "chave do servidor diferente da guardada";
  }
  const last = stderr.trim().split(/\r?\n/).at(-1) ?? "";
  return last === "" ? `o ssh terminou com código ${code}` : last.slice(0, 200);
}

/**
 * Opens a ssh destino in a terminal of this host (phase 15): the argv is a list and never goes
 * through a shell, the server keys come from the pins, and a key from the vault is delivered for
 * this one connection only.
 */
export class SshConnector {
  private readonly active = new Set<Plan>();
  private readonly timers: Timers;
  private readonly win: boolean;

  constructor(private readonly opts: SshConnectorOptions) {
    this.timers = opts.timers ?? realTimers;
    this.win = (opts.platform ?? process.platform) === "win32";
  }

  async connect(req: {
    targetId: string;
    cols: number;
    rows: number;
    privateKey?: string;
  }): Promise<TerminalInfo> {
    const plan = await this.plan(this.target(req.targetId), req.privateKey, "connect");
    try {
      const info = this.opts.terminals.open({
        cwd: this.opts.dir,
        command: plan.argv,
        env: plan.env,
        internal: true,
        cols: req.cols,
        rows: req.rows,
        onExit: () => plan.release(),
      });
      plan.timer = this.timers.set(() => plan.release(), DELIVERY_MS);
      return info;
    } catch (error) {
      plan.release();
      throw error;
    }
  }

  /** `ssh -o BatchMode=yes … exit 0`: whether the destino can be reached and logged in. */
  async test(req: {
    targetId: string;
    privateKey?: string;
  }): Promise<{ ok: boolean; error: string | null }> {
    const target = this.target(req.targetId);
    if (target.auth === "password") {
      return { ok: false, error: "o teste não cobre senha: conecte para testar" };
    }
    const plan = await this.plan(target, req.privateKey, "test");
    try {
      const result = await this.opts.run(plan.argv, plan.env);
      return result.code === 0
        ? { ok: true, error: null }
        : { ok: false, error: translate(result.stderr, result.code) };
    } finally {
      plan.release();
    }
  }

  /**
   * Phase 17: runs an `ssh:` action on the destino named `target`. The argv arrives quoted as one
   * remote command and the environment goes over stdin; a key from the vault is delivered for
   * this one run.
   */
  async exec(req: {
    target: string;
    argv: string[];
    env: Record<string, string>;
    timeoutS: number;
    privateKey?: string;
  }): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }> {
    const named = this.opts.targets.list().filter((t) => t.name === req.target);
    if (named.length === 0) {
      throw new FlightdeckError("not_found", `destino ${req.target} não encontrado`);
    }
    if (named.length > 1) {
      throw new FlightdeckError("invalid_state", `há mais de um destino chamado ${req.target}`);
    }
    const target = named[0] as SshTarget;
    if (target.auth === "password") {
      throw new FlightdeckError(
        "invalid_state",
        `${target.name} usa senha: uma ação ssh roda sem ninguém para digitá-la`,
      );
    }
    const run = this.opts.exec;
    if (!run) throw new FlightdeckError("invalid_state", "este daemon não roda ações ssh");
    // Checked before a key is delivered: a bad variable stops here.
    const input = envInput(req.env);
    const plan = await this.plan(target, req.privateKey, "exec", req.argv);
    try {
      const done = await run(plan.argv, plan.env, input, req.timeoutS * 1000);
      return {
        exitCode: done.code,
        stdout: done.stdout,
        stderr: done.stderr,
        timedOut: done.timedOut,
      };
    } finally {
      plan.release();
    }
  }

  /** Takes away every key still delivered. */
  stop(): void {
    for (const plan of [...this.active]) plan.release();
  }

  private target(id: string): SshTarget {
    const target = this.opts.targets.get(id);
    if (!target) throw new FlightdeckError("not_found", "destino não encontrado");
    return target;
  }

  private async plan(
    target: SshTarget,
    privateKey: string | undefined,
    mode: Mode,
    remote: string[] = [],
  ): Promise<Plan> {
    const { targets } = this.opts;
    if (target.auth === "vault-key" && !privateKey) {
      throw new FlightdeckError("bad_request", "a chave do cofre não veio com o pedido");
    }
    if (target.auth !== "vault-key" && privateKey) {
      throw new FlightdeckError("bad_request", "a chave do cofre só vale para vault-key");
    }
    if (target.auth === "password" && !this.opts.askpass) {
      throw new FlightdeckError("invalid_state", "senha pede o askpass, que não está disponível");
    }
    // The outermost jump first, the target last.
    const members: SshTarget[] = [];
    for (let at: SshTarget | null = target; at; at = at.jump ? targets.get(at.jump) : null) {
      members.unshift(at);
    }
    const hops = members.slice(0, -1);
    for (const hop of hops) {
      if (hop.auth === "vault-key" || hop.auth === "password") {
        throw new FlightdeckError(
          "invalid_state",
          `o jump ${hop.name} usa ${hop.auth}: um jump só pode usar agent ou chave em arquivo`,
        );
      }
    }
    for (const member of members) await this.trust(member);

    const delivered: DeliveredKey | null = privateKey
      ? await this.opts.delivery.deliver(privateKey)
      : null;
    let released = false;
    const plan: Plan = {
      argv: [],
      env: {},
      release: () => {
        if (released) return;
        released = true;
        if (plan.timer !== undefined) this.timers.clear(plan.timer);
        this.active.delete(plan);
        delivered?.cleanup();
      },
    };
    try {
      const { config, knownHosts } = this.files(members, hops, mode);
      plan.argv = this.argv(target, hops, delivered, { config, knownHosts }, mode, remote);
      plan.env = { ...delivered?.env, ...this.askpassEnv(target, mode) };
    } catch (error) {
      plan.release();
      throw error;
    }
    this.active.add(plan);
    return plan;
  }

  /** The pinned key must be the one the server shows; unreadable from here, the pin is what ssh checks. */
  private async trust(member: SshTarget): Promise<void> {
    let check: Awaited<ReturnType<HostKeys["check"]>>;
    try {
      check = await this.opts.hostKeys.check(member.id);
    } catch (error) {
      if (!(error instanceof ScanFailed)) throw error;
      if (this.opts.targets.pinned(member.id)) return;
      throw new FlightdeckError(
        "invalid_state",
        `não consegui ler a chave de ${member.name} daqui: a primeira conexão precisa alcançá-lo direto`,
      );
    }
    if (check.status === "unknown") {
      throw new FlightdeckError(
        "hostkey_unconfirmed",
        `${member.name}: confirme o fingerprint ${check.fingerprint} antes de conectar`,
      );
    }
    if (check.status === "changed") {
      throw new FlightdeckError(
        "hostkey_changed",
        `${member.name}: a chave do servidor mudou (guardada ${check.pinned}, agora ${check.fingerprint})`,
      );
    }
  }

  /** The value of a path in an ssh option or config: slashes on Windows, quotes around spaces. */
  private value(path: string): string {
    const text = this.win ? path.replaceAll("\\", "/") : path;
    return /\s/.test(text) ? `"${text}"` : text;
  }

  private get nul(): string {
    return this.win ? "NUL" : "/dev/null";
  }

  /** Writes (once) the known_hosts and the ssh config, each named by the hash of its content. */
  private files(members: SshTarget[], hops: SshTarget[], mode: Mode) {
    const known = `${members
      .flatMap((m) => knownHostsLines(m.host, m.port, this.opts.targets.pinned(m.id)?.keys ?? []))
      .join("\n")}\n`;
    const knownHosts = this.named("kh-", known);
    const lines = [
      "Host *",
      `  BatchMode ${mode === "connect" ? "no" : "yes"}`,
      "  StrictHostKeyChecking yes",
      `  UserKnownHostsFile ${this.value(knownHosts)}`,
      `  GlobalKnownHostsFile ${this.nul}`,
      "  IdentitiesOnly no",
      "  ForwardAgent no",
    ];
    // ssh -J starts each jump with only -F: what a hop needs has to be in this file.
    for (const hop of hops) {
      if (hop.auth !== "key-file") continue;
      lines.push(`Host ${hop.host}`, `  IdentityFile ${this.value(hop.secretRef as string)}`);
      lines.push("  IdentitiesOnly yes");
    }
    const config = this.named("config-", `${lines.join("\n")}\n`);
    return { config, knownHosts };
  }

  private named(prefix: string, content: string): string {
    mkdirSync(this.opts.dir, { recursive: true });
    const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
    const file = join(this.opts.dir, `${prefix}${hash}`);
    if (!existsSync(file)) writeFileSync(file, content);
    return file;
  }

  private argv(
    target: SshTarget,
    hops: SshTarget[],
    delivered: DeliveredKey | null,
    files: { config: string; knownHosts: string },
    mode: Mode,
    remote: string[],
  ): string[] {
    const usesFile = target.auth === "key-file" || delivered?.identityFile;
    const identitiesOnly = usesFile || target.auth === "password" ? "yes" : "no";
    const { options } = target;
    const argv = [
      this.opts.sshPath,
      "-F",
      this.win ? files.config.replaceAll("\\", "/") : files.config,
      "-o",
      `BatchMode=${mode === "connect" ? "no" : "yes"}`,
      "-o",
      `IdentitiesOnly=${identitiesOnly}`,
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      `UserKnownHostsFile=${this.value(files.knownHosts)}`,
      "-o",
      `GlobalKnownHostsFile=${this.nul}`,
      "-o",
      `ForwardAgent=${options.forwardAgent ? "yes" : "no"}`,
    ];
    if (options.serverAliveInterval) {
      argv.push("-o", `ServerAliveInterval=${options.serverAliveInterval}`);
    }
    if (options.compression) argv.push("-o", "Compression=yes");
    for (const forward of options.localForward ?? []) argv.push("-L", forward);
    if (target.auth === "key-file") argv.push("-i", target.secretRef as string);
    if (delivered?.identityFile) {
      argv.push(
        "-i",
        this.win ? delivered.identityFile.replaceAll("\\", "/") : delivered.identityFile,
      );
    }
    if (target.auth === "password") {
      argv.push(
        "-o",
        "PreferredAuthentications=password,keyboard-interactive",
        "-o",
        "PubkeyAuthentication=no",
      );
    }
    if (hops.length > 0) {
      const hop = (h: SshTarget) =>
        `${h.user}@${h.host.includes(":") ? `[${h.host}]` : h.host}:${h.port}`;
      argv.push("-J", hops.map(hop).join(","));
    }
    if (mode !== "connect") argv.push("-o", "ConnectTimeout=10");
    // An action has no terminal: its output is read, and its stdin carries the environment.
    if (mode === "exec") argv.push("-T");
    argv.push("-p", String(target.port), "--", `${target.user}@${target.host}`);
    if (mode === "test") argv.push("exit", "0");
    if (mode === "exec") argv.push(remoteCommand(remote));
    return argv;
  }

  /** Passwords and key passphrases come from the vault through SSH_ASKPASS, with a ticket. */
  private askpassEnv(target: SshTarget, mode: Mode): Record<string, string> {
    const askpass = this.opts.askpass;
    // BatchMode=yes never asks, so a test or an action has nothing to answer.
    if (!askpass || target.auth === "agent" || mode !== "connect") return {};
    const password = target.auth === "password";
    return {
      SSH_ASKPASS: askpass.script,
      SSH_ASKPASS_REQUIRE: password ? "force" : "prefer",
      FLIGHTDECK_ASKPASS_TICKET: askpass.ticket(target, password ? "password" : "passphrase"),
      FLIGHTDECK_CONFIG: askpass.configFile,
    };
  }
}
