import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { startServer } from "../src/server.ts";
import { HostKeys, knownHostsLines } from "../src/ssh/hostkey.ts";
import { SshTargets } from "../src/ssh/targets.ts";
import { EventStore } from "../src/store/event-store.ts";
import { newManager, workspace } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "ssh-hostkey-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

// A key generated for the tests (never one of the user's), and the fingerprint ssh-keygen gave it.
const ED25519 = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPHyii7r5lIz9AQ/c2vlfTxoKQtFoDLtWtwxRY/fF9Fl";
const ED25519_FINGERPRINT = "SHA256:5gaKG0bjmxouPIYIwZp+MDQqiFMkPvsxoXDW7mFO1hw";
// Blobs that are valid base64 and nothing more: enough for fingerprints and known_hosts lines.
const RSA = `ssh-rsa ${Buffer.from("rsa-key-of-the-test-0123456789").toString("base64")}`;
const ECDSA = `ecdsa-sha2-nistp256 ${Buffer.from("ecdsa-key-of-the-test-0123456789").toString("base64")}`;
const OTHER = `ssh-ed25519 ${Buffer.from("another-server-key-0123456789").toString("base64")}`;

const fingerprintOf = (key: string) =>
  `SHA256:${createHash("sha256")
    .update(Buffer.from(key.split(" ")[1] as string, "base64"))
    .digest("base64")
    .replace(/=+$/, "")}`;

/** ssh-keyscan output for a host: one line per key, and the comment lines it prints. */
const scanOutput = (host: string, keys: string[]) =>
  `${[`# ${host}:22 SSH-2.0-OpenSSH_9.6`, ...keys.map((key) => `${host} ${key}`)].join("\n")}\n`;

function setup(now = () => Date.parse("2026-10-29T12:00:00Z")) {
  const store = new EventStore(":memory:");
  const targets = new SshTargets({ db: store.db });
  const calls: string[][] = [];
  let reply: { code: number; stdout: string } = { code: 0, stdout: scanOutput("h", [ED25519]) };
  const keys = new HostKeys({
    targets,
    now,
    exec: async (cmd) => {
      calls.push(cmd);
      return reply;
    },
  });
  const target = targets.save({ name: "vps", host: "vps.example.com", user: "deploy", port: 2222 });
  return {
    targets,
    keys,
    calls,
    target,
    serve: (stdout: string, code = 0) => {
      reply = { code, stdout };
    },
  };
}

async function codeOf(fn: () => unknown): Promise<string> {
  try {
    await fn();
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? "sem código";
  }
}

describe("ssh-hostkey", () => {
  test("a primeira conexão lê a chave com ssh-keyscan, mostra o fingerprint e não guarda nada até confirmar", async () => {
    const { keys, calls, target, targets } = setup();
    const result = await keys.check(target.id);
    expect(result).toEqual({
      status: "unknown",
      fingerprint: ED25519_FINGERPRINT,
      pinned: null,
    });
    // An argv, never a shell; the host after "--" so it is never read as an option.
    expect(calls).toEqual([
      ["ssh-keyscan", "-T", "5", "-t", "ed25519,ecdsa,rsa", "-p", "2222", "--", "vps.example.com"],
    ]);
    expect(targets.get(target.id)?.hostKey).toBeNull();
  });

  test("confirmar o fingerprint mostrado o guarda com todas as chaves; as conexões seguintes o reconhecem", async () => {
    const { keys, target, targets, serve } = setup();
    serve(scanOutput("h", [RSA, ECDSA, ED25519]));
    // The fingerprint shown is the ed25519 one, whatever order the scan listed the keys in.
    const first = await keys.check(target.id);
    expect(first.fingerprint).toBe(ED25519_FINGERPRINT);
    const pinned = keys.confirm(target.id, ED25519_FINGERPRINT);
    expect(pinned.hostKey).toBe(ED25519_FINGERPRINT);
    expect(targets.pinned(target.id)).toEqual({
      fingerprint: ED25519_FINGERPRINT,
      keys: [ED25519, ECDSA, RSA],
    });
    expect(await keys.check(target.id)).toEqual({
      status: "pinned",
      fingerprint: ED25519_FINGERPRINT,
      pinned: ED25519_FINGERPRINT,
    });
  });

  test("só se confirma o que acabou de ser mostrado: outro fingerprint, sem verificação ou verificação velha são recusados", async () => {
    let clock = Date.parse("2026-10-29T12:00:00Z");
    const { keys, target, targets } = setup(() => clock);
    // Never shown.
    expect(await codeOf(() => keys.confirm(target.id, ED25519_FINGERPRINT))).toBe("invalid_state");
    await keys.check(target.id);
    expect(await codeOf(() => keys.confirm(target.id, "SHA256:outra"))).toBe("invalid_state");
    // Shown, but too long ago.
    clock += 6 * 60_000;
    expect(await codeOf(() => keys.confirm(target.id, ED25519_FINGERPRINT))).toBe("invalid_state");
    expect(targets.get(target.id)?.hostKey).toBeNull();
    // A fresh check and the right fingerprint: pinned. A second confirm has nothing to confirm.
    await keys.check(target.id);
    expect(keys.confirm(target.id, ED25519_FINGERPRINT).hostKey).toBe(ED25519_FINGERPRINT);
    expect(await codeOf(() => keys.confirm(target.id, ED25519_FINGERPRINT))).toBe("invalid_state");
    expect(await codeOf(() => keys.confirm("nada", ED25519_FINGERPRINT))).toBe("not_found");
  });

  test("um fingerprint diferente bloqueia e mostra o antigo e o novo; trocar só esquecendo antes", async () => {
    const { keys, target, serve, targets } = setup();
    await keys.check(target.id);
    keys.confirm(target.id, ED25519_FINGERPRINT);
    serve(scanOutput("h", [OTHER]));
    const changed = await keys.check(target.id);
    expect(changed).toEqual({
      status: "changed",
      fingerprint: fingerprintOf(OTHER),
      pinned: ED25519_FINGERPRINT,
    });
    // Seeing the new fingerprint is not enough to replace the old one.
    expect(await codeOf(() => keys.confirm(target.id, fingerprintOf(OTHER)))).toBe("invalid_state");
    expect(targets.get(target.id)?.hostKey).toBe(ED25519_FINGERPRINT);
    // Forgetting is explicit; then the new key is a first connection again.
    expect(keys.forget(target.id).hostKey).toBeNull();
    expect((await keys.check(target.id)).status).toBe("unknown");
    expect(keys.confirm(target.id, fingerprintOf(OTHER)).hostKey).toBe(fingerprintOf(OTHER));
  });

  test("esquecer limpa a chave guardada; um destino que não existe é not_found", async () => {
    const { keys, target, targets } = setup();
    await keys.check(target.id);
    keys.confirm(target.id, ED25519_FINGERPRINT);
    keys.forget(target.id);
    expect(targets.pinned(target.id)).toBeNull();
    expect(await codeOf(() => keys.forget("nada"))).toBe("not_found");
    expect(await codeOf(() => keys.check("nada"))).toBe("not_found");
  });

  test("ssh-keyscan que falha, que não devolve chave ou devolve lixo é recusado, e só os tipos conhecidos valem", async () => {
    const { keys, target, serve } = setup();
    for (const [stdout, code] of [
      ["", 1],
      ["", 0],
      ["# so um comentario\n", 0],
      ["h ssh-dss AAAA\nh sk-ssh-ed25519@openssh.com AAAA\nh ssh-ed25519 não é base64!\n", 0],
    ] as const) {
      serve(stdout, code);
      expect([stdout.slice(0, 20), code, await codeOf(() => keys.check(target.id))]).toEqual([
        stdout.slice(0, 20),
        code,
        "invalid_state",
      ]);
    }
    serve(`h ssh-dss AAAA\n${scanOutput("h", [ED25519])}`);
    expect((await keys.check(target.id)).fingerprint).toBe(ED25519_FINGERPRINT);
  });

  test("o known_hosts próprio: host sozinho na 22, [host]:porta nas outras, uma linha por chave", () => {
    expect(knownHostsLines("vps.example.com", 22, [ED25519, RSA])).toEqual([
      `vps.example.com ${ED25519}`,
      `vps.example.com ${RSA}`,
    ]);
    expect(knownHostsLines("vps.example.com", 2222, [ED25519])).toEqual([
      `[vps.example.com]:2222 ${ED25519}`,
    ]);
    expect(knownHostsLines("fd7a:115c::1", 22, [ED25519])).toEqual([`fd7a:115c::1 ${ED25519}`]);
  });

  test("pelo protocolo: ssh.hostkey.check, confirm e forget", async () => {
    const { keys, target, targets } = setup();
    const { root } = workspace();
    const server = startServer({
      manager: newManager().manager,
      ssh: targets,
      sshHostKeys: keys,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    expect(await client.data("ssh.hostkey.check", { targetId: target.id })).toEqual({
      status: "unknown",
      fingerprint: ED25519_FINGERPRINT,
      pinned: null,
    });
    expect(
      await client.data("ssh.hostkey.confirm", {
        targetId: target.id,
        fingerprint: ED25519_FINGERPRINT,
      }),
    ).toMatchObject({ id: target.id, hostKey: ED25519_FINGERPRINT });
    expect(await client.data("ssh.hostkey.forget", { targetId: target.id })).toMatchObject({
      hostKey: null,
    });
    const missing = await client.request("ssh.hostkey.check", { targetId: "nada" });
    expect((missing.error as { code?: string } | undefined)?.code).toBe("not_found");
  });

  test("sem o verificador configurado, os comandos dizem que está desativado", async () => {
    const { root } = workspace();
    const server = startServer({
      manager: newManager().manager,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const ack = await client.request("ssh.hostkey.forget", { targetId: "x" });
    expect((ack.error as { code?: string } | undefined)?.code).toBe("invalid_state");
  });

  test("a refusal of the host keys carries a reason the app translates, in English for logs", async () => {
    const { keys, target } = setup();
    expect(await why(() => keys.confirm("nada", ED25519_FINGERPRINT))).toMatchObject({
      code: "not_found",
      reason: "ssh_target_not_found",
    });
    await keys.check(target.id);
    const wrong = await why(() => keys.confirm(target.id, "SHA256:outra"));
    expect(wrong).toMatchObject({ code: "invalid_state", reason: "ssh_hostkey_mismatch" });
    expect(wrong?.message).not.toMatch(/[À-ú]|\bchave\b/);
    keys.confirm(target.id, ED25519_FINGERPRINT);
    expect(await why(() => keys.confirm(target.id, ED25519_FINGERPRINT))).toMatchObject({
      code: "invalid_state",
      reason: "ssh_hostkey_exists",
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
