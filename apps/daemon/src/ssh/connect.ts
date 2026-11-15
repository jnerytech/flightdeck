import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SshTarget, SshTestResult, TerminalInfo } from "@flightdeck/protocol";
import { inSequence } from "@flightdeck/protocol";
import { envInput, remoteCommand } from "../actions/index.ts";
import { FlightdeckError } from "../kernel/index.ts";
import type { Timers } from "../quota/index.ts";
import type { TerminalManager } from "../terminal/index.ts";
import { execTarget, jumpChain, refuseAuth, refuseHostKey } from "./domain/connect-rules.ts";
import {
  type AskpassHook,
  askpassEnv,
  knownHostsText,
  type Mode,
  sshArgv,
  sshConfigText,
} from "./domain/ssh-argv.ts";
import { translate } from "./domain/test-result.ts";
import { type HostKeys, ScanFailed } from "./hostkey.ts";
import type { DeliveredKey, KeyDelivery } from "./key-delivery.ts";
import type { SshTargets } from "./targets.ts";

/** Runs ssh without a terminal (the connection test) and returns its stderr. */
export type RunSsh = (
  argv: string[],
  env: Record<string, string>,
) => Promise<{ code: number; stderr: string }>;

/** Phase 17: runs ssh for an action, writing `input` to its stdin and keeping what it prints. */
export type ExecSsh = (
  argv: string[],
  env: Record<string, string>,
  input: string,
  timeoutMs: number,
) => Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }>;

/**
 * The `ssh` to run. On Windows the OpenSSH of the system, which is the one that takes `NUL` and
 * `-F`, when it exists; otherwise whatever the PATH finds.
 */
export async function resolveSshPath(opts: {
  platform: NodeJS.Platform;
  exists: (path: string) => boolean | Promise<boolean>;
  which: (name: string) => string | null;
}): Promise<string> {
  if (opts.platform === "win32") {
    const windows = process.env.SystemRoot ?? String.raw`C:\Windows`;
    const system = String.raw`${windows}\System32\OpenSSH\ssh.exe`;
    if (await opts.exists(system)) return system;
  }
  return opts.which("ssh") ?? "ssh";
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

interface Plan {
  argv: string[];
  env: Record<string, string>;
  /** The undo that fires after 60 s. */
  timer?: unknown;
  /** Idempotent: takes the delivered key away and forgets the timer. */
  release(): Promise<void>;
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
      const info = await this.opts.terminals.open({
        cwd: this.opts.dir,
        command: plan.argv,
        env: plan.env,
        internal: true,
        cols: req.cols,
        rows: req.rows,
        onExit: () => void plan.release(),
      });
      plan.timer = this.timers.set(() => void plan.release(), DELIVERY_MS);
      return info;
    } catch (error) {
      await plan.release();
      throw error;
    }
  }

  /** `ssh -o BatchMode=yes … exit 0`: whether the destino can be reached and logged in. */
  async test(req: { targetId: string; privateKey?: string }): Promise<SshTestResult> {
    const target = this.target(req.targetId);
    if (target.auth === "password") {
      return {
        ok: false,
        error: "the test does not cover passwords: connect to test",
        reason: "ssh_test_no_password",
      };
    }
    const plan = await this.plan(target, req.privateKey, "test");
    try {
      const result = await this.opts.run(plan.argv, plan.env);
      return result.code === 0 ? { ok: true, error: null } : translate(result.stderr, result.code);
    } finally {
      await plan.release();
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
    const target = execTarget(req.target, this.opts.targets.byName(req.target), () =>
      this.opts.targets.countNamed(req.target),
    );
    const run = this.opts.exec;
    if (!run) {
      throw new FlightdeckError(
        "invalid_state",
        "this daemon does not run ssh actions",
        "ssh_exec_off",
      );
    }
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
      await plan.release();
    }
  }

  /** Takes away every key still delivered. */
  async stop(): Promise<void> {
    await Promise.all([...this.active].map((plan) => plan.release()));
  }

  private target(id: string): SshTarget {
    const target = this.opts.targets.get(id);
    if (!target) {
      throw new FlightdeckError("not_found", "destination not found", "ssh_target_not_found");
    }
    return target;
  }

  private async plan(
    target: SshTarget,
    privateKey: string | undefined,
    mode: Mode,
    remote: string[] = [],
  ): Promise<Plan> {
    const { targets } = this.opts;
    refuseAuth(target, privateKey, !!this.opts.askpass);
    const { members, hops } = jumpChain(target, (id) => targets.get(id));
    await inSequence(members, async (member) => {
      await this.trust(member);
    });

    const delivered: DeliveredKey | null = privateKey
      ? await this.opts.delivery.deliver(privateKey)
      : null;
    let released = false;
    const plan: Plan = {
      argv: [],
      env: {},
      release: async () => {
        if (released) return;
        released = true;
        if (plan.timer !== undefined) this.timers.clear(plan.timer);
        this.active.delete(plan);
        await delivered?.cleanup();
      },
    };
    try {
      const { config, knownHosts } = await this.files(members, hops, mode);
      plan.argv = sshArgv({
        sshPath: this.opts.sshPath,
        win: this.win,
        target,
        hops,
        delivered,
        files: { config, knownHosts },
        mode,
        remoteCommand: mode === "exec" ? remoteCommand(remote) : "",
      });
      plan.env = { ...delivered?.env, ...askpassEnv(this.opts.askpass, target, mode) };
    } catch (error) {
      await plan.release();
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
        `could not read the key of ${member.name} from here: the first connection must reach it directly`,
        "ssh_key_unreachable",
        { name: member.name },
      );
    }
    refuseHostKey(member, check);
  }

  /** Writes (once) the known_hosts and the ssh config, each named by the hash of its content. */
  private async files(members: SshTarget[], hops: SshTarget[], mode: Mode) {
    const known = knownHostsText(members, (id) => this.opts.targets.pinned(id)?.keys);
    const knownHosts = await this.named("kh-", known);
    const config = await this.named(
      "config-",
      sshConfigText({ win: this.win, mode, knownHosts, hops }),
    );
    return { config, knownHosts };
  }

  private async named(prefix: string, content: string): Promise<string> {
    await mkdir(this.opts.dir, { recursive: true });
    const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
    const file = join(this.opts.dir, `${prefix}${hash}`);
    // `wx` keeps a file that is already there: the name is the hash of the content.
    await writeFile(file, content, { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    return file;
  }
}
