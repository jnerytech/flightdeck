import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../../src/config.ts";
import { processOps } from "../../src/ssh/adapters/agent-process.ts";
import { processRun } from "../../src/ssh/adapters/ssh-process.ts";
import { resolveSshPath, SshConnector } from "../../src/ssh/connect.ts";
import { HostKeys } from "../../src/ssh/hostkey.ts";
import { chooseDelivery } from "../../src/ssh/key-delivery.ts";
import { tempDir } from "../support/helpers.ts";
import {
  cleanups,
  drainCleanups,
  KEY,
  PRIVATE,
  scan,
  setup,
  started,
} from "../support/ssh-connect.ts";

afterEach(drainCleanups);

describe("ssh-connect: peças", () => {
  test("com os timers de verdade, o desfazer de 60 s é agendado e cancelado ao parar", async () => {
    const s = setup();
    const target = s.targets.save({
      name: "cofre",
      host: "vault.example.com",
      user: "me",
      auth: "vault-key",
      secretRef: "x",
    });
    s.pin(target.id);
    s.servers.set("vault.example.com", scan("vault.example.com", KEY));
    let cleaned = 0;
    const real = new SshConnector({
      targets: s.targets,
      hostKeys: new HostKeys({
        targets: s.targets,
        exec: async () => scan("vault.example.com", KEY),
      }),
      terminals: s.terminals,
      dir: s.dir,
      platform: "linux",
      sshPath: "/usr/bin/ssh",
      run: async () => ({ code: 0, stderr: "" }),
      delivery: {
        kind: "agent",
        deliver: async () => ({ identityFile: null, env: {}, cleanup: () => void cleaned++ }),
      },
    });
    await real.connect({ targetId: target.id, cols: 80, rows: 24, privateKey: PRIVATE });
    expect(cleaned).toBe(0);
    await real.stop();
    expect(cleaned).toBe(1);
  });

  test("uma chave entregue como arquivo vai em -i (com barras no Windows) e IdentitiesOnly=yes", async () => {
    const s = setup({ platform: "win32" });
    const target = s.targets.save({
      name: "cofre",
      host: "vault.example.com",
      user: "me",
      auth: "vault-key",
      secretRef: "x",
    });
    s.pin(target.id);
    s.servers.set("vault.example.com", scan("vault.example.com", KEY));
    const files = new SshConnector({
      targets: s.targets,
      hostKeys: new HostKeys({
        targets: s.targets,
        exec: async () => scan("vault.example.com", KEY),
      }),
      terminals: s.terminals,
      dir: s.dir,
      platform: "win32",
      sshPath: "C:/ssh.exe",
      run: async () => ({ code: 0, stderr: "" }),
      delivery: {
        kind: "file",
        deliver: async () => ({
          identityFile: "C:\\data\\ssh\\keys\\key-1",
          env: {},
          cleanup: () => {},
        }),
      },
    });
    cleanups.push(() => files.stop());
    await files.connect({ targetId: target.id, cols: 80, rows: 24, privateKey: PRIVATE });
    const { argv } = started(s);
    expect(argv).toContain("IdentitiesOnly=yes");
    expect(argv.slice(argv.indexOf("-i"), argv.indexOf("-i") + 2)).toEqual([
      "-i",
      "C:/data/ssh/keys/key-1",
    ]);
  });

  test("se os arquivos do ssh não podem ser escritos, a chave entregue é desfeita e o erro sobe", async () => {
    const s = setup({ dir: join(tempDir(), "arquivo") });
    // A file where the folder should be.
    await Bun.write(s.dir, "x");
    const target = s.targets.save({
      name: "cofre",
      host: "vault.example.com",
      user: "me",
      auth: "vault-key",
      secretRef: "x",
    });
    s.pin(target.id);
    s.servers.set("vault.example.com", scan("vault.example.com", KEY));
    await expect(s.open(target.id, { privateKey: PRIVATE })).rejects.toThrow();
    expect(s.delivered[0]?.cleaned).toBe(1);
    expect(s.ptys.spawned).toEqual([]);
  });

  test("a entrega certa por sistema: arquivo no Windows, agent nos outros", () => {
    const common = {
      keysDir: tempDir(),
      sockDir: tempDir(),
      user: "dev",
      exec: async () => ({ code: 0, stdout: "" }),
      ops: processOps(),
    };
    expect(chooseDelivery({ platform: "win32", ...common }).kind).toBe("file");
    expect(chooseDelivery({ platform: "linux", ...common }).kind).toBe("agent");
    expect(chooseDelivery({ platform: "darwin", ...common }).kind).toBe("agent");
  });

  test("a config pode apontar o ssh a usar, e um caminho vazio é recusado", async () => {
    const write = (ssh: unknown) => {
      const file = join(tempDir(), "config.json");
      writeFileSync(file, JSON.stringify({ token: "t".repeat(32), ssh }));
      return file;
    };
    expect((await loadConfig(write({ path: "/opt/openssh/ssh" }))).ssh.path).toBe(
      "/opt/openssh/ssh",
    );
    expect((await loadConfig(write({}))).ssh.path).toBeUndefined();
    await expect(loadConfig(write({ path: "" }))).rejects.toThrow();
  });

  test("o ssh de verdade: o System32 no Windows quando existe, senão o do PATH, senão só ssh", async () => {
    const system32 = `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\OpenSSH\\ssh.exe`;
    const both = { exists: (path: string) => path === system32, which: () => "/x/ssh" };
    expect(await resolveSshPath({ platform: "win32", ...both })).toBe(system32);
    expect(
      await resolveSshPath({
        platform: "win32",
        exists: () => false,
        which: () => "C:\\Git\\ssh.exe",
      }),
    ).toBe("C:\\Git\\ssh.exe");
    expect(await resolveSshPath({ platform: "linux", ...both })).toBe("/x/ssh");
    expect(
      await resolveSshPath({ platform: "linux", exists: () => false, which: () => null }),
    ).toBe("ssh");
  });

  test("rodar o ssh sem terminal: o ambiente se soma ao do processo, a saída é descartada e o stderr é lido", async () => {
    const seen: Array<{ cmd: string[]; env: Record<string, string>; stdin: unknown }> = [];
    const spawn = ((cmd: string[], options: { env: Record<string, string>; stdin: unknown }) => {
      seen.push({ cmd, env: options.env, stdin: options.stdin });
      return { stderr: new Response("Permission denied").body, exited: Promise.resolve(255) };
    }) as unknown as Parameters<typeof processRun>[0];
    const result = await processRun(spawn)(["ssh", "-V"], { SSH_AUTH_SOCK: "/tmp/s" });
    expect(result).toEqual({ code: 255, stderr: "Permission denied" });
    expect(seen[0]?.cmd).toEqual(["ssh", "-V"]);
    expect(seen[0]?.env.SSH_AUTH_SOCK).toBe("/tmp/s");
    expect(seen[0]?.env.PATH).toBe(process.env.PATH);
    expect(seen[0]?.stdin).toBe("ignore");
  });
});
