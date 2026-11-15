import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { processOps } from "../../src/ssh/adapters/agent-process.ts";
import {
  type AgentOps,
  createAgentDelivery,
  createFileDelivery,
} from "../../src/ssh/key-delivery.ts";
import { tempDir } from "../support/helpers.ts";
import { drainCleanups, KEY, NEW_KEY, PRIVATE, scan, setup } from "../support/ssh-connect.ts";

afterEach(drainCleanups);

describe("ssh-connect: entrega da chave do cofre", () => {
  test("arquivo (Windows): só do dono, na pasta do daemon, apagado ao desfazer; no Windows o dono vem do icacls", async () => {
    const dir = tempDir();
    const commands: string[][] = [];
    const delivery = createFileDelivery({
      dir,
      platform: "win32",
      user: "dev",
      exec: async (cmd) => {
        commands.push(cmd);
        return { code: 0, stdout: "" };
      },
      id: () => "abc123",
    });
    expect(delivery.kind).toBe("file");
    const delivered = await delivery.deliver(PRIVATE);
    const file = delivered.identityFile ?? "";
    expect(file.startsWith(dir)).toBe(true);
    // OpenSSH wants the final newline.
    expect(readFileSync(file, "utf8")).toBe(`${PRIVATE}\n`);
    expect(commands).toEqual([["icacls", file, "/inheritance:r", "/grant:r", "dev:(R,W,D)"]]);
    expect(delivered.env).toEqual({});
    const cleaning = delivered.cleanup();
    expect(cleaning).toBeInstanceOf(Promise);
    await cleaning;
    expect(readdirSync(dir).filter((name) => name.includes("abc123"))).toEqual([]);
    // Cleaning again, or after the file is gone, is fine.
    await delivered.cleanup();
  });

  test("arquivo (fora do Windows): modo 0600 e nenhum icacls; se restringir falha, o arquivo some e o erro sobe", async () => {
    const dir = tempDir();
    const commands: string[][] = [];
    const posix = createFileDelivery({
      dir,
      platform: "linux",
      user: "dev",
      exec: async (cmd) => {
        commands.push(cmd);
        return { code: 0, stdout: "" };
      },
      id: () => "p1",
    });
    const delivered = await posix.deliver(PRIVATE);
    expect(commands).toEqual([]);
    if (process.platform !== "win32") {
      expect(statSync(delivered.identityFile ?? "").mode & 0o777).toBe(0o600);
    }
    await delivered.cleanup();
    const failing = createFileDelivery({
      dir,
      platform: "win32",
      user: "dev",
      exec: async () => ({ code: 5, stdout: "" }),
      id: () => "p2",
    });
    await expect(failing.deliver(PRIVATE)).rejects.toMatchObject({
      code: "internal",
      reason: "ssh_key_perms",
    });
    expect(readdirSync(dir).filter((name) => name.includes("p2"))).toEqual([]);
  });

  function agentOps(overrides: Partial<AgentOps> = {}) {
    const calls: Array<{ what: string; detail: unknown }> = [];
    const ops: AgentOps = {
      startAgent: (sock) => {
        calls.push({ what: "start", detail: sock });
        return { stop: () => calls.push({ what: "stop", detail: sock }) };
      },
      waitForSocket: async () => true,
      run: async (cmd, opts) => {
        calls.push({
          what: "run",
          detail: { cmd, env: opts.env.SSH_AUTH_SOCK, stdin: opts.stdin },
        });
        return { code: 0 };
      },
      ...overrides,
    };
    return { ops, calls };
  }

  test("agent por conexão: ssh-agent -a no socket próprio, a chave por ssh-add - no stdin, SSH_AUTH_SOCK só para o ssh, e o agent encerrado depois", async () => {
    const dir = tempDir();
    const { ops, calls } = agentOps();
    const delivery = createAgentDelivery({ sockDir: dir, ops, id: () => "s1" });
    expect(delivery.kind).toBe("agent");
    const delivered = await delivery.deliver(PRIVATE);
    const sock = join(dir, "fd-s1.sock");
    expect(delivered).toMatchObject({ identityFile: null, env: { SSH_AUTH_SOCK: sock } });
    expect(calls).toEqual([
      { what: "start", detail: sock },
      { what: "run", detail: { cmd: ["ssh-add", "-"], env: sock, stdin: `${PRIVATE}\n` } },
    ]);
    await delivered.cleanup();
    await delivered.cleanup();
    expect(calls.filter((c) => c.what === "stop")).toHaveLength(1);
  });

  test("agent que não sobe ou ssh-add que falha: o agent é encerrado e o erro não repete a chave", async () => {
    const dir = tempDir();
    const silent = agentOps({ waitForSocket: async () => false });
    await expect(
      createAgentDelivery({ sockDir: dir, ops: silent.ops, id: () => "s2" }).deliver(PRIVATE),
    ).rejects.toMatchObject({ code: "internal", reason: "ssh_agent_down" });
    expect(silent.calls.map((c) => c.what)).toEqual(["start", "stop"]);
    const refusing = agentOps({ run: async () => ({ code: 1 }) });
    const error = await createAgentDelivery({ sockDir: dir, ops: refusing.ops, id: () => "s3" })
      .deliver(PRIVATE)
      .catch((e: Error) => e);
    expect(error).toMatchObject({ code: "internal", reason: "ssh_add_refused" });
    expect((error as Error).message).toMatch(/ssh-add/);
    expect((error as Error).message).not.toContain("TEST-ONLY");
    expect(refusing.calls.map((c) => c.what)).toEqual(["start", "stop"]);
  });

  test("sem um id dado, cada conexão tem o socket de um nome curto e diferente", async () => {
    const dir = tempDir();
    const { ops, calls } = agentOps();
    const delivery = createAgentDelivery({ sockDir: dir, ops });
    await delivery.deliver(PRIVATE);
    await delivery.deliver(PRIVATE);
    const socks = calls.filter((c) => c.what === "start").map((c) => String(c.detail));
    expect(socks[0]).toMatch(/fd-[0-9A-Z]{10}\.sock$/);
    expect(new Set(socks).size).toBe(2);
  });

  test("as operações de processo: ssh-agent -D -a, espera o socket, e ssh-add com a chave no stdin", async () => {
    const spawned: Array<{ cmd: string[]; stdin: unknown; wrote: string[]; killed: boolean }> = [];
    const spawn = ((cmd: string[], options: { stdin: unknown }) => {
      const record = { cmd, stdin: options.stdin, wrote: [] as string[], killed: false };
      spawned.push(record);
      return {
        stdin: { write: (text: string) => record.wrote.push(text), end: () => {} },
        exited: Promise.resolve(0),
        kill: () => {
          record.killed = true;
        },
      };
    }) as unknown as Parameters<typeof processOps>[0];
    let present = 0;
    const ops = processOps(
      spawn,
      () => ++present >= 3,
      async () => {},
    );
    const agent = ops.startAgent("/tmp/s.sock");
    expect(spawned[0]?.cmd).toEqual(["ssh-agent", "-D", "-a", "/tmp/s.sock"]);
    agent.stop();
    expect(spawned[0]?.killed).toBe(true);
    // The socket shows up on the third look.
    expect(await ops.waitForSocket("/tmp/s.sock")).toBe(true);
    expect(present).toBe(3);
    present = -1000;
    expect(await ops.waitForSocket("/tmp/s.sock")).toBe(false);
    const result = await ops.run(["ssh-add", "-"], {
      env: { SSH_AUTH_SOCK: "/tmp/s.sock" },
      stdin: "KEY\n",
    });
    expect(result).toEqual({ code: 0 });
    expect(spawned[1]).toMatchObject({ cmd: ["ssh-add", "-"], stdin: "pipe", wrote: ["KEY\n"] });
  });

  test("a refusal of a connection carries a reason and params the app translates", async () => {
    const s = setup();
    s.targets.save({
      id: s.bastion.id,
      name: "bastion",
      host: "bastion.example.com",
      user: "jump",
      auth: "password",
    });
    s.pin(s.bastion.id);
    expect(await why(() => s.open(s.inner.id))).toMatchObject({
      code: "invalid_state",
      reason: "ssh_jump_auth",
      params: { name: "bastion", auth: "password" },
    });
    s.targets.save({
      id: s.bastion.id,
      name: "bastion",
      host: "bastion.example.com",
      user: "jump",
    });
    const fresh = s.targets.save({ name: "novo", host: "novo.example.com", user: "me" });
    s.servers.set("novo.example.com", scan("novo.example.com", KEY));
    const unknown = await why(() => s.open(fresh.id));
    expect(unknown).toMatchObject({
      code: "hostkey_unconfirmed",
      reason: "ssh_hostkey_unconfirmed",
      params: { name: "novo" },
    });
    expect(String(unknown?.params?.fingerprint)).toStartWith("SHA256:");
    s.servers.set("vps.example.com", scan("vps.example.com", NEW_KEY));
    const changed = await why(() => s.open(s.vps.id));
    expect(changed).toMatchObject({
      code: "hostkey_changed",
      reason: "ssh_hostkey_changed",
      params: { name: "vps", pinned: s.targets.get(s.vps.id)?.hostKey },
    });
    expect(String(changed?.params?.fingerprint)).toStartWith("SHA256:");
    s.servers.delete("10.0.0.9");
    const lone = s.targets.save({ name: "sozinho", host: "lone.example.com", user: "me" });
    expect(await why(() => s.open(lone.id))).toMatchObject({
      reason: "ssh_key_unreachable",
      params: { name: "sozinho" },
    });
    expect(await why(() => s.open("nada"))).toMatchObject({
      code: "not_found",
      reason: "ssh_target_not_found",
    });
    for (const refused of [unknown, changed]) {
      expect(refused?.message).not.toMatch(/[À-ú]|\b(confirme|antes de conectar)\b/);
    }
  });

  test("a vault key that is missing or not wanted, and a password without askpass, each have a reason", async () => {
    const s = setup();
    const target = s.targets.save({
      name: "cofre",
      host: "vault.example.com",
      user: "me",
      auth: "vault-key",
      secretRef: "chave-da-vps",
    });
    s.pin(target.id);
    s.servers.set("vault.example.com", scan("vault.example.com", KEY));
    expect(await why(() => s.open(target.id))).toMatchObject({
      code: "bad_request",
      reason: "ssh_key_missing",
    });
    expect(await why(() => s.open(s.vps.id, { privateKey: PRIVATE }))).toMatchObject({
      code: "bad_request",
      reason: "ssh_key_not_for_auth",
    });
    const bare = setup({ askpass: false });
    const password = bare.targets.save({
      name: "senha",
      host: "pw.example.com",
      user: "me",
      auth: "password",
    });
    bare.pin(password.id);
    bare.servers.set("pw.example.com", scan("pw.example.com", KEY));
    expect(await why(() => bare.open(password.id))).toMatchObject({
      code: "invalid_state",
      reason: "ssh_askpass_off",
    });
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

describe("ssh-connect: the real ssh-agent helper", () => {
  test("it looks for its socket on disk, and gives up after 40 looks", async () => {
    const dir = tempDir("fd-agent-");
    const sock = join(dir, "agent.sock");
    writeFileSync(sock, "");
    const slept: number[] = [];
    const ops = processOps(undefined, undefined, async (ms) => void slept.push(ms));
    expect(await ops.waitForSocket(sock)).toBe(true);
    expect(await ops.waitForSocket(join(dir, "never.sock"))).toBe(false);
    expect(slept).toHaveLength(40);
  });
});
