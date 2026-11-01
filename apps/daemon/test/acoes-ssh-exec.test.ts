import { afterEach, describe, expect, test } from "bun:test";
import { envInput, remoteCommand } from "../src/actions/ssh-command.ts";
import { type ExecSsh, processExec, SshConnector } from "../src/ssh/connect.ts";
import { HostKeys } from "../src/ssh/hostkey.ts";
import type { DeliveredKey } from "../src/ssh/key-delivery.ts";
import { SshTargets } from "../src/ssh/targets.ts";
import { EventStore } from "../src/store/event-store.ts";
import { tempDir } from "./helpers.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

// Keys generated for the tests; never one of the user's.
const KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPHyii7r5lIz9AQ/c2vlfTxoKQtFoDLtWtwxRY/fF9Fl";
const PRIVATE =
  "-----BEGIN OPENSSH PRIVATE KEY-----\nTEST-ONLY-ACTION-KEY-41b9\n-----END OPENSSH PRIVATE KEY-----";
const SECRET = "action-env-secret-8d2e";

const code = async (fn: () => unknown): Promise<string> => {
  try {
    await fn();
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? "sem código";
  }
};

/** A connector whose ssh is a recorder, with the destinos prod (agent) and vault (vault-key). */
function setup(reply = { code: 0, stdout: "deployed\n", stderr: "", timedOut: false }) {
  const store = new EventStore(":memory:");
  const targets = new SshTargets({ db: store.db });
  const hostKeys = new HostKeys({
    targets,
    exec: async (cmd) => ({ code: 0, stdout: `${cmd.at(-1)} ${KEY}\n` }),
  });
  const execs: Array<{ argv: string[]; env: Record<string, string>; input: string; ms: number }> =
    [];
  let fail = false;
  const exec: ExecSsh = async (argv, env, input, ms) => {
    execs.push({ argv, env, input, ms });
    if (fail) throw new Error("ssh caiu");
    return reply;
  };
  const delivered: Array<{ key: string; cleaned: number }> = [];
  const connector = new SshConnector({
    targets,
    hostKeys,
    terminals: { open: () => ({}) as never },
    dir: tempDir(),
    platform: "linux",
    sshPath: "/usr/bin/ssh",
    run: async () => ({ code: 0, stderr: "" }),
    exec,
    delivery: {
      kind: "agent",
      deliver: async (key): Promise<DeliveredKey> => {
        const record = { key, cleaned: 0 };
        delivered.push(record);
        return {
          identityFile: null,
          env: { SSH_AUTH_SOCK: "/tmp/fd-action.sock" },
          cleanup: () => {
            record.cleaned++;
          },
        };
      },
    },
  });
  cleanups.push(() => connector.stop());
  const pinned = (input: Parameters<SshTargets["save"]>[0]) => {
    const target = targets.save(input);
    targets.pin(target.id, { fingerprint: "SHA256:x", keys: [KEY] });
    return target;
  };
  pinned({ name: "prod", host: "prod.example.com", user: "deploy", port: 2222 });
  pinned({
    name: "cofre",
    host: "vault.example.com",
    user: "ops",
    auth: "vault-key",
    secretRef: "deploy-key",
  });
  return { connector, targets, execs, delivered, pinned, failNext: () => (fail = true) };
}

describe("acoes-execucao: an ssh action runs on its destino", () => {
  test("ssh gets the pins, no tty and the remote command as one argument; the environment goes on stdin and nowhere else", async () => {
    const { connector, execs } = setup();
    const argv = ["./deploy.sh", "main; rm -rf ~"];
    const result = await connector.exec({
      target: "prod",
      argv,
      env: { DEPLOY_TOKEN: SECRET },
      timeoutS: 30,
    });
    expect(result).toEqual({ exitCode: 0, stdout: "deployed\n", stderr: "", timedOut: false });
    const [run] = execs;
    expect(run?.argv[0]).toBe("/usr/bin/ssh");
    expect(run?.argv).toContain("BatchMode=yes");
    expect(run?.argv).toContain("StrictHostKeyChecking=yes");
    expect(run?.argv).toContain("-T");
    expect(run?.argv.slice(-3)).toEqual(["--", "deploy@prod.example.com", remoteCommand(argv)]);
    expect(run?.argv[run.argv.indexOf("-p") + 1]).toBe("2222");
    expect(run?.input).toBe(envInput({ DEPLOY_TOKEN: SECRET }));
    expect(run?.ms).toBe(30_000);
    expect(JSON.stringify(run?.argv)).not.toContain(SECRET);
    expect(JSON.stringify(run?.env)).not.toContain(SECRET);
  });

  test("a key from the vault is delivered for that one run and taken away after it, also when ssh fails; it is never in the argv, the env or stdin", async () => {
    const { connector, execs, delivered, failNext } = setup();
    await connector.exec({
      target: "cofre",
      argv: ["uptime"],
      env: {},
      timeoutS: 5,
      privateKey: PRIVATE,
    });
    expect(delivered.map((d) => [d.key, d.cleaned])).toEqual([[PRIVATE, 1]]);
    expect(execs[0]?.env).toEqual({ SSH_AUTH_SOCK: "/tmp/fd-action.sock" });
    failNext();
    const failed = await code(() =>
      connector.exec({
        target: "cofre",
        argv: ["uptime"],
        env: {},
        timeoutS: 5,
        privateKey: PRIVATE,
      }),
    );
    expect(failed).not.toBe("ok");
    expect(delivered.map((d) => d.cleaned)).toEqual([1, 1]);
    for (const run of execs) {
      expect(JSON.stringify([run.argv, run.env, run.input])).not.toContain("TEST-ONLY-ACTION-KEY");
    }
    // vault-key without the key, or a key for a destino that does not use one, is refused.
    expect(
      await code(() => connector.exec({ target: "cofre", argv: ["x"], env: {}, timeoutS: 5 })),
    ).toBe("bad_request");
  });

  test("an unknown destino, a name two destinos share, or a destino with a password is refused before ssh runs", async () => {
    const { connector, execs, pinned } = setup();
    expect(
      await code(() => connector.exec({ target: "nada", argv: ["x"], env: {}, timeoutS: 5 })),
    ).toBe("not_found");
    pinned({ name: "prod", host: "other.example.com", user: "deploy" });
    expect(
      await code(() => connector.exec({ target: "prod", argv: ["x"], env: {}, timeoutS: 5 })),
    ).toBe("invalid_state");
    pinned({ name: "senha", host: "pw.example.com", user: "u", auth: "password" });
    expect(
      await code(() => connector.exec({ target: "senha", argv: ["x"], env: {}, timeoutS: 5 })),
    ).toBe("invalid_state");
    expect(execs).toEqual([]);
  });
});

describe("acoes-execucao: the process that runs ssh for an action", () => {
  test("writes stdin, keeps stdout and stderr and the exit code", async () => {
    const run = processExec();
    const result = await run(
      [
        process.execPath,
        "-e",
        "const t = await Bun.stdin.text(); console.log(t.trim()); console.error('e'); process.exit(3)",
      ],
      {},
      "from-stdin\n",
      10_000,
    );
    expect(result).toEqual({ code: 3, stdout: "from-stdin\n", stderr: "e\n", timedOut: false });
  });

  test("a run past its time is killed and says so", async () => {
    const run = processExec();
    const result = await run([process.execPath, "-e", "await Bun.sleep(20000)"], {}, "", 200);
    expect(result.timedOut).toBe(true);
  });

  test("exec refusals carry a reason and params: unknown name, a name two share, a password, no executor", async () => {
    const { connector, pinned } = setup();
    const refuse = (target: string) =>
      why(() => connector.exec({ target, argv: ["x"], env: {}, timeoutS: 5 }));
    expect(await refuse("nada")).toMatchObject({
      code: "not_found",
      reason: "ssh_target_unknown",
      params: { name: "nada" },
    });
    pinned({ name: "prod", host: "other.example.com", user: "deploy" });
    expect(await refuse("prod")).toMatchObject({
      reason: "ssh_target_ambiguous",
      params: { name: "prod" },
    });
    pinned({ name: "senha", host: "pw.example.com", user: "u", auth: "password" });
    const password = await refuse("senha");
    expect(password).toMatchObject({
      reason: "ssh_password_in_action",
      params: { name: "senha" },
    });
    expect(password?.message).not.toMatch(/[À-ú]|\b(usa senha|ninguém)\b/);
    const store = new EventStore(":memory:");
    const targets = new SshTargets({ db: store.db });
    targets.save({ name: "solo", host: "solo.example.com", user: "u" });
    const noExec = new SshConnector({
      targets,
      hostKeys: new HostKeys({ targets, exec: async () => ({ code: 1, stdout: "" }) }),
      terminals: { open: () => ({}) as never },
      dir: tempDir(),
      platform: "linux",
      sshPath: "/usr/bin/ssh",
      run: async () => ({ code: 0, stderr: "" }),
      delivery: {
        kind: "agent",
        deliver: async (): Promise<DeliveredKey> => ({
          identityFile: null,
          env: {},
          cleanup: () => {},
        }),
      },
    });
    expect(
      await why(() => noExec.exec({ target: "solo", argv: ["x"], env: {}, timeoutS: 5 })),
    ).toMatchObject({ code: "invalid_state", reason: "ssh_exec_off" });
  });
});

/** What a refusal carries: the code, the reason the app translates, its params and the log text. */
async function why(fn: () => unknown) {
  try {
    await fn();
    return null;
  } catch (error) {
    const { code, reason, params, message } = error as {
      code: string;
      reason?: string;
      params?: Record<string, string | number>;
      message: string;
    };
    return { code, reason, params, message };
  }
}
