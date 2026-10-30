import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FlightdeckError } from "../errors.ts";
import type { Exec } from "../exec.ts";
import { ulid } from "../ulid.ts";

/** A private key made available to one `ssh` run, and how to take it away again. */
export interface DeliveredKey {
  /** The file to pass in `-i`, when the key is a file. */
  identityFile: string | null;
  /** Variables for that one `ssh` (`SSH_AUTH_SOCK` of its own agent). */
  env: Record<string, string>;
  /** Idempotent: deletes the file or stops the agent. */
  cleanup(): void;
}

/**
 * How a key from the vault reaches `ssh` without staying on disk (phase 15): `agent` loads it into
 * a ssh-agent made for the connection, `file` writes an owner-only temporary file. The Windows
 * OpenSSH agent only runs as a service with a fixed pipe, so there the file is what works.
 */
export interface KeyDelivery {
  kind: "file" | "agent";
  deliver(key: string): Promise<DeliveredKey>;
}

/** OpenSSH refuses a key file without the final newline. */
const withNewline = (key: string) => (key.endsWith("\n") ? key : `${key}\n`);

export interface FileDeliveryOptions {
  /** A folder of the daemon's own. */
  dir: string;
  platform: NodeJS.Platform;
  /** The user the Windows ACL is left to. */
  user: string;
  /** Runs `icacls`. */
  exec: Exec;
  id?: () => string;
}

export function createFileDelivery(opts: FileDeliveryOptions): KeyDelivery {
  const newId = opts.id ?? ulid;
  return {
    kind: "file",
    deliver: async (key) => {
      mkdirSync(opts.dir, { recursive: true });
      const file = join(opts.dir, `key-${newId()}`);
      // Created empty and restricted first, so the key is never in a file others can read.
      writeFileSync(file, "", { mode: 0o600 });
      if (opts.platform === "win32") {
        const done = await opts.exec([
          "icacls",
          file,
          "/inheritance:r",
          "/grant:r",
          `${opts.user}:(R,W,D)`,
        ]);
        if (done.code !== 0) {
          rmSync(file, { force: true });
          throw new FlightdeckError(
            "internal",
            "não consegui restringir as permissões do arquivo da chave",
          );
        }
      }
      writeFileSync(file, withNewline(key));
      return { identityFile: file, env: {}, cleanup: () => rmSync(file, { force: true }) };
    },
  };
}

export interface AgentOps {
  /** `ssh-agent -D -a <sock>`: stays in the foreground, so it can be stopped. */
  startAgent(sock: string): { stop(): void };
  /** Whether the agent's socket showed up. */
  waitForSocket(sock: string): Promise<boolean>;
  run(
    cmd: string[],
    options: { env: Record<string, string>; stdin: string },
  ): Promise<{ code: number }>;
}

export interface AgentDeliveryOptions {
  /** A short folder (a Unix socket path is limited to about 100 characters). */
  sockDir: string;
  ops: AgentOps;
  id?: () => string;
}

export function createAgentDelivery(opts: AgentDeliveryOptions): KeyDelivery {
  const newId = opts.id ?? (() => ulid().slice(-10));
  return {
    kind: "agent",
    deliver: async (key) => {
      const sock = join(opts.sockDir, `fd-${newId()}.sock`);
      const agent = opts.ops.startAgent(sock);
      if (!(await opts.ops.waitForSocket(sock))) {
        agent.stop();
        throw new FlightdeckError("internal", "o ssh-agent da conexão não subiu");
      }
      const added = await opts.ops.run(["ssh-add", "-"], {
        env: { PATH: process.env.PATH ?? "", SSH_AUTH_SOCK: sock },
        stdin: withNewline(key),
      });
      if (added.code !== 0) {
        agent.stop();
        throw new FlightdeckError("internal", "o ssh-add recusou a chave");
      }
      let stopped = false;
      return {
        identityFile: null,
        env: { SSH_AUTH_SOCK: sock },
        cleanup: () => {
          if (stopped) return;
          stopped = true;
          agent.stop();
        },
      };
    },
  };
}

type Spawn = (
  cmd: string[],
  options: {
    env: Record<string, string | undefined>;
    stdin: "ignore" | "pipe";
    stdout: "ignore";
    stderr: "ignore";
  },
) => {
  stdin: { write(text: string): unknown; end(): unknown };
  exited: Promise<number>;
  kill(): void;
};

const SOCKET_LOOKS = 40;

/** The real `ssh-agent` and `ssh-add`, over an injectable `spawn`. */
export function processOps(
  spawn: Spawn = Bun.spawn as unknown as Spawn,
  exists: (path: string) => boolean = existsSync,
  sleep: (ms: number) => Promise<unknown> = Bun.sleep,
): AgentOps {
  return {
    startAgent: (sock) => {
      const proc = spawn(["ssh-agent", "-D", "-a", sock], {
        env: process.env,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      });
      return { stop: () => proc.kill() };
    },
    waitForSocket: async (sock) => {
      for (let look = 0; look < SOCKET_LOOKS; look++) {
        if (exists(sock)) return true;
        await sleep(50);
      }
      return false;
    },
    run: async (cmd, options) => {
      const proc = spawn(cmd, {
        env: options.env,
        stdin: "pipe",
        stdout: "ignore",
        stderr: "ignore",
      });
      proc.stdin.write(options.stdin);
      proc.stdin.end();
      return { code: await proc.exited };
    },
  };
}

/** A file on Windows, a per-connection agent elsewhere. */
export function chooseDelivery(opts: {
  platform: NodeJS.Platform;
  keysDir: string;
  sockDir: string;
  user: string;
  exec: Exec;
  ops: AgentOps;
}): KeyDelivery {
  return opts.platform === "win32"
    ? createFileDelivery({
        dir: opts.keysDir,
        platform: opts.platform,
        user: opts.user,
        exec: opts.exec,
      })
    : createAgentDelivery({ sockDir: opts.sockDir, ops: opts.ops });
}
