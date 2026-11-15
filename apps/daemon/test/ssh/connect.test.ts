import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { SshConnector } from "../../src/ssh/connect.ts";
import { HostKeys } from "../../src/ssh/hostkey.ts";
import { tempDir } from "../support/helpers.ts";
import {
  drainCleanups,
  KEY,
  NEW_KEY,
  PRIVATE,
  scan,
  setup,
  started,
} from "../support/ssh-connect.ts";

afterEach(drainCleanups);

const code = async (fn: () => unknown): Promise<string> => {
  try {
    await fn();
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? "sem código";
  }
};

describe("ssh-connect", () => {
  test("agent: o argv é uma lista com BatchMode=no, StrictHostKeyChecking=yes, o known_hosts próprio e o destino depois de --", async () => {
    const s = setup();
    const info = await s.open(s.vps.id);
    const run = started(s);
    expect(run.argv).toEqual([
      "/usr/bin/ssh",
      "-F",
      run.config,
      "-o",
      "BatchMode=no",
      "-o",
      "IdentitiesOnly=no",
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      `UserKnownHostsFile=${run.knownHosts}`,
      "-o",
      "GlobalKnownHostsFile=/dev/null",
      "-o",
      "ForwardAgent=no",
      "-p",
      "2222",
      "--",
      "deploy@vps.example.com",
    ]);
    expect(info).toMatchObject({ command: "ssh", exitCode: null });
    // The files live in the daemon's own folder, never in ~/.ssh.
    expect(run.config.startsWith(s.dir)).toBe(true);
    expect(run.knownHosts.startsWith(s.dir)).toBe(true);
    expect(run.pty.cwd).toBe(s.dir);
    expect(readFileSync(run.knownHosts, "utf8")).toBe(`[vps.example.com]:2222 ${KEY}\n`);
    expect(readFileSync(run.config, "utf8")).toContain("Host *\n");
    expect(readFileSync(run.config, "utf8")).toContain("StrictHostKeyChecking yes");
  });

  test("key-file usa -i com IdentitiesOnly=yes; as opções viram -o e -L; ForwardAgent só quando ligado", async () => {
    const s = setup();
    const target = s.targets.save({
      name: "chave",
      host: "key.example.com",
      user: "me",
      auth: "key-file",
      secretRef: "~/.ssh/id_ed25519",
      options: {
        serverAliveInterval: 30,
        compression: true,
        forwardAgent: true,
        localForward: ["8080:localhost:80", "127.0.0.1:5432:db.internal:5432"],
      },
      confirm: true,
    });
    s.pin(target.id);
    s.servers.set("key.example.com", scan("key.example.com", KEY));
    await s.open(target.id);
    const { argv } = started(s);
    const joined = argv.join(" ");
    expect(joined).toContain("-o IdentitiesOnly=yes");
    expect(joined).toContain("-i ~/.ssh/id_ed25519");
    expect(joined).toContain("-o ForwardAgent=yes");
    expect(joined).toContain("-o ServerAliveInterval=30");
    expect(joined).toContain("-o Compression=yes");
    expect(argv.filter((_word, i) => argv[i - 1] === "-L")).toEqual([
      "8080:localhost:80",
      "127.0.0.1:5432:db.internal:5432",
    ]);
    expect(argv.slice(-4, -2)).toEqual(["-p", "22"]);
    expect(argv.at(-1)).toBe("me@key.example.com");
    expect(argv.at(-2)).toBe("--");
  });

  test("com jump: -J user@host:porta e o known_hosts e o config valem para cada salto; o salto usa agent ou key-file", async () => {
    const s = setup();
    s.targets.save({
      id: s.bastion.id,
      name: "bastion",
      host: "bastion.example.com",
      user: "jump",
      auth: "key-file",
      secretRef: "~/.ssh/bastion",
    });
    s.pin(s.bastion.id);
    await s.open(s.inner.id);
    const run = started(s);
    expect(run.argv.slice(run.argv.indexOf("-J"), run.argv.indexOf("-J") + 2)).toEqual([
      "-J",
      "jump@bastion.example.com:22",
    ]);
    expect(run.argv.at(-1)).toBe("ana@10.0.0.9");
    const lines = readFileSync(run.knownHosts, "utf8").trim().split("\n").sort();
    expect(lines).toEqual([`10.0.0.9 ${KEY}`, `bastion.example.com ${KEY}`]);
    // ssh -J starts the jump with only -F: the strict settings and its key come from the config.
    const config = readFileSync(run.config, "utf8");
    expect(config).toContain("UserKnownHostsFile");
    expect(config).toContain("Host bastion.example.com\n  IdentityFile ~/.ssh/bastion\n");
  });

  test("um salto com vault-key ou senha não é suportado e nada é aberto", async () => {
    const s = setup();
    s.targets.save({
      id: s.bastion.id,
      name: "bastion",
      host: "bastion.example.com",
      user: "jump",
      auth: "password",
    });
    s.pin(s.bastion.id);
    expect(await code(() => s.open(s.inner.id))).toBe("invalid_state");
    expect(s.ptys.spawned).toEqual([]);
  });

  test("a chave do servidor desconhecida ou trocada bloqueia, com o fingerprint (e o antigo e o novo), e nada é aberto", async () => {
    const s = setup();
    const fresh = s.targets.save({ name: "novo", host: "novo.example.com", user: "me" });
    s.servers.set("novo.example.com", scan("novo.example.com", KEY));
    const unknown = await s.open(fresh.id).catch((e: Error & { code: string }) => e);
    expect((unknown as { code: string }).code).toBe("hostkey_unconfirmed");
    expect((unknown as Error).message).toMatch(/novo.*SHA256:/);
    s.servers.set("vps.example.com", scan("vps.example.com", NEW_KEY));
    const changed = await s.open(s.vps.id).catch((e: Error & { code: string }) => e);
    expect((changed as { code: string }).code).toBe("hostkey_changed");
    expect((changed as Error).message).toContain(s.targets.get(s.vps.id)?.hostKey ?? "faltou");
    expect((changed as Error).message).toMatch(/SHA256:.*SHA256:/);
    // A jump whose key changed blocks the target behind it too.
    s.servers.set("bastion.example.com", scan("bastion.example.com", NEW_KEY));
    expect(await code(() => s.open(s.inner.id))).toBe("hostkey_changed");
    expect(s.ptys.spawned).toEqual([]);
  });

  test("não dá para ler a chave daqui: segue com a guardada (o ssh confere), ou recusa se nunca foi guardada", async () => {
    const s = setup();
    // Behind a jump the daemon cannot scan the target itself: the pinned key is what ssh checks.
    s.servers.delete("10.0.0.9");
    await s.open(s.inner.id);
    expect(s.ptys.spawned).toHaveLength(1);
    const lone = s.targets.save({ name: "sozinho", host: "lone.example.com", user: "me" });
    expect(await code(() => s.open(lone.id))).toBe("invalid_state");
    expect(s.ptys.spawned).toHaveLength(1);
    // Any other failure is not swallowed.
    expect(await code(() => s.open("nada"))).toBe("not_found");
  });

  test("vault-key: a chave entra pela entrega, o ssh recebe -i ou o agent daquela conexão, e a chave não aparece em argv, ambiente nem log", async () => {
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
    expect(await code(() => s.open(target.id))).toBe("bad_request");
    expect(await code(() => s.open(s.vps.id, { privateKey: PRIVATE }))).toBe("bad_request");
    await s.open(target.id, { privateKey: PRIVATE });
    expect(s.delivered).toEqual([{ key: PRIVATE, cleaned: 0 }]);
    const run = started(s);
    expect(run.pty.env.SSH_AUTH_SOCK).toBe("/tmp/fd-test.sock");
    const everything = JSON.stringify([run.argv, run.pty.env, s.logs]);
    expect(everything).not.toContain("TEST-ONLY-NOT-A-REAL-KEY");
    expect(everything).not.toContain("PRIVATE KEY");
  });

  test("a entrega é desfeita uma vez só: em 60 s, quando o terminal acaba, ou ao parar o conector", async () => {
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
    await s.open(target.id, { privateKey: PRIVATE });
    s.time.advance(59_000);
    expect(s.delivered[0]?.cleaned).toBe(0);
    s.time.advance(1_000);
    expect(s.delivered[0]?.cleaned).toBe(1);
    // The process ending afterwards does not clean twice.
    s.ptys.spawned[0]?.exit(0);
    expect(s.delivered[0]?.cleaned).toBe(1);
    // Ending first cleans at once; the timer then finds nothing to do.
    await s.open(target.id, { privateKey: PRIVATE });
    s.ptys.spawned[1]?.exit(255);
    expect(s.delivered[1]?.cleaned).toBe(1);
    s.time.advance(60_000);
    expect(s.delivered[1]?.cleaned).toBe(1);
    // Stopping the connector cleans what is still around.
    await s.open(target.id, { privateKey: PRIVATE });
    await s.connector.stop();
    expect(s.delivered[2]?.cleaned).toBe(1);
  });

  test("uma entrega que falha não deixa nada aberto", async () => {
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
    const failing = new SshConnector({
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
        deliver: async () => {
          throw new Error("agent não subiu");
        },
      },
    });
    await expect(
      failing.connect({ targetId: target.id, cols: 80, rows: 24, privateKey: PRIVATE }),
    ).rejects.toThrow(/agent não subiu/);
    expect(s.ptys.spawned).toEqual([]);
  });

  test("senha vai pelo SSH_ASKPASS com um ticket; a senha não existe aqui, e a chave com frase também usa o askpass", async () => {
    const s = setup();
    const password = s.targets.save({
      name: "senha",
      host: "pw.example.com",
      user: "me",
      auth: "password",
      secretRef: "senha-da-vps",
    });
    const keyed = s.targets.save({
      name: "frase",
      host: "kf.example.com",
      user: "me",
      auth: "key-file",
      secretRef: "~/.ssh/id",
    });
    for (const t of [password, keyed]) {
      s.pin(t.id);
      s.servers.set(t.host, scan(t.host, KEY));
    }
    await s.open(password.id);
    const first = started(s, 0);
    expect(first.pty.env).toMatchObject({
      SSH_ASKPASS: "/data/ssh/askpass.sh",
      SSH_ASKPASS_REQUIRE: "force",
      FLIGHTDECK_ASKPASS_TICKET: "ticket-1",
      FLIGHTDECK_CONFIG: "/home/u/.flightdeck/config.json",
    });
    expect(first.argv.join(" ")).toContain(
      "-o PreferredAuthentications=password,keyboard-interactive",
    );
    expect(first.argv.join(" ")).toContain("-o PubkeyAuthentication=no");
    expect(JSON.stringify([first.argv, first.pty.env])).not.toContain("senha-da-vps");
    await s.open(keyed.id);
    expect(started(s, 1).pty.env.SSH_ASKPASS_REQUIRE).toBe("prefer");
    expect(s.tickets).toEqual([
      ["senha", "password"],
      ["frase", "passphrase"],
    ]);
    // An agent destino never asks.
    await s.open(s.vps.id);
    expect(started(s, 2).pty.env.SSH_ASKPASS).toBeUndefined();
  });

  test("sem askpass configurado, senha é recusada e as chaves seguem sem ele", async () => {
    const s = setup({ askpass: false });
    const password = s.targets.save({
      name: "senha",
      host: "pw.example.com",
      user: "me",
      auth: "password",
    });
    s.pin(password.id);
    s.servers.set("pw.example.com", scan("pw.example.com", KEY));
    expect(await code(() => s.open(password.id))).toBe("invalid_state");
    const keyed = s.targets.save({
      name: "k",
      host: "kf.example.com",
      user: "me",
      auth: "key-file",
      secretRef: "~/.ssh/id",
    });
    s.pin(keyed.id);
    s.servers.set("kf.example.com", scan("kf.example.com", KEY));
    await s.open(keyed.id);
    expect(started(s).pty.env.SSH_ASKPASS).toBeUndefined();
  });

  test("no Windows os caminhos usam barras e NUL, e um espaço no caminho vai entre aspas", async () => {
    const base = tempDir();
    const dir = join(base, "com espaço");
    mkdirSync(dir, { recursive: true });
    const s = setup({ platform: "win32", dir });
    await s.open(s.vps.id);
    const { argv } = started(s);
    const slashes = dir.replaceAll("\\", "/");
    const kh = argv.find((word) => word.startsWith("UserKnownHostsFile=")) ?? "";
    expect(kh.startsWith(`UserKnownHostsFile="${slashes}/`)).toBe(true);
    expect(kh.endsWith('"')).toBe(true);
    expect(argv).toContain("GlobalKnownHostsFile=NUL");
    expect(readFileSync(argv[argv.indexOf("-F") + 1] ?? "", "utf8")).toContain("NUL");
  });

  test("os arquivos têm o nome do conteúdo: abrir de novo reaproveita, e outra chave gera outro", async () => {
    const s = setup();
    await s.open(s.vps.id);
    await s.open(s.vps.id);
    const first = started(s, 0);
    const second = started(s, 1);
    expect(second.knownHosts).toBe(first.knownHosts);
    expect(second.config).toBe(first.config);
    const mtime = statSync(first.knownHosts).mtimeMs;
    await Bun.sleep(5);
    await s.open(s.vps.id);
    expect(statSync(first.knownHosts).mtimeMs).toBe(mtime);
    s.pin(s.vps.id, NEW_KEY);
    s.servers.set("vps.example.com", scan("vps.example.com", NEW_KEY));
    await s.open(s.vps.id);
    expect(started(s, 3).knownHosts).not.toBe(first.knownHosts);
    expect(readdirSync(s.dir).filter((name) => name.startsWith("kh-"))).toHaveLength(2);
  });

  test("terminal desligado: o erro do terminal sobe e a entrega é desfeita", async () => {
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
    s.terminals.setEnabled(false);
    expect(await code(() => s.open(target.id, { privateKey: PRIVATE }))).toBe("terminal_disabled");
    expect(s.delivered[0]?.cleaned).toBe(1);
  });

  test("o teste de conexão roda ssh -o BatchMode=yes … exit 0 com os mesmos arquivos e devolve ok ou o erro traduzido", async () => {
    const s = setup();
    expect(await s.probe(s.vps.id)).toEqual({ ok: true, error: null });
    const { argv } = s.runs[0] ?? { argv: [] };
    expect(argv.slice(0, 1)).toEqual(["/usr/bin/ssh"]);
    expect(argv).toContain("BatchMode=yes");
    expect(argv).not.toContain("BatchMode=no");
    expect(argv).toContain("ConnectTimeout=10");
    expect(argv.slice(-4)).toEqual(["--", "deploy@vps.example.com", "exit", "0"]);
    expect(argv.join(" ")).toContain("StrictHostKeyChecking=yes");
    // No terminal is opened for a test.
    expect(s.ptys.spawned).toEqual([]);
    const translated: Array<
      [string, string, string | undefined, Record<string, number> | undefined]
    > = [
      [
        "deploy@vps.example.com: Permission denied (publickey).",
        "authentication refused",
        "ssh_test_auth",
        undefined,
      ],
      [
        "ssh: connect to host vps.example.com port 2222: Connection refused",
        "connection refused",
        "ssh_test_refused",
        undefined,
      ],
      [
        "ssh: Could not resolve hostname vps.example.com: Name or service not known",
        "host not found",
        "ssh_test_host_unknown",
        undefined,
      ],
      [
        "ssh: connect to host vps.example.com port 2222: Connection timed out",
        "timed out",
        "ssh_test_timeout",
        undefined,
      ],
      [
        "Host key verification failed.",
        "the server key differs from the saved one",
        "ssh_test_hostkey",
        undefined,
      ],
      ["something odd happened", "something odd happened", undefined, undefined],
      ["", "ssh exited with code 255", "ssh_test_exit", { code: 255 }],
    ];
    for (const [stderr, text, reason, params] of translated) {
      s.answer(255, stderr);
      const got = await s.probe(s.vps.id);
      expect(got).toEqual({
        ok: false,
        error: text,
        ...(reason ? { reason } : {}),
        ...(params ? { params } : {}),
      });
    }
    // Only the last line of a long message, and not an endless one.
    s.answer(
      255,
      `warning: one
${"x".repeat(500)}`,
    );
    expect(((await s.probe(s.vps.id)).error ?? "").length).toBeLessThanOrEqual(200);
  });

  test("o teste confere a chave do servidor como a conexão, não testa senha e desfaz a entrega da chave logo depois", async () => {
    const s = setup();
    s.servers.set("vps.example.com", scan("vps.example.com", NEW_KEY));
    expect(await code(() => s.probe(s.vps.id))).toBe("hostkey_changed");
    expect(s.runs).toEqual([]);
    const password = s.targets.save({
      name: "senha",
      host: "pw.example.com",
      user: "me",
      auth: "password",
    });
    s.pin(password.id);
    s.servers.set("pw.example.com", scan("pw.example.com", KEY));
    const noPassword = await s.probe(password.id);
    expect(noPassword.ok).toBe(false);
    expect(noPassword.error).toMatch(/password/);
    expect(noPassword.reason).toBe("ssh_test_no_password");
    expect(s.runs).toEqual([]);
    const vault = s.targets.save({
      name: "cofre",
      host: "vault.example.com",
      user: "me",
      auth: "vault-key",
      secretRef: "x",
    });
    s.pin(vault.id);
    s.servers.set("vault.example.com", scan("vault.example.com", KEY));
    expect(await code(() => s.probe(vault.id))).toBe("bad_request");
    expect((await s.probe(vault.id, { privateKey: PRIVATE })).ok).toBe(true);
    expect(s.delivered).toEqual([{ key: PRIVATE, cleaned: 1 }]);
    expect(s.runs[0]?.env.SSH_AUTH_SOCK).toBe("/tmp/fd-test.sock");
    // The delivery is also undone when the run itself blows up.
    const boom = new SshConnector({
      targets: s.targets,
      hostKeys: new HostKeys({
        targets: s.targets,
        exec: async () => scan("vault.example.com", KEY),
      }),
      terminals: s.terminals,
      dir: s.dir,
      platform: "linux",
      sshPath: "/usr/bin/ssh",
      run: async () => {
        throw new Error("spawn falhou");
      },
      delivery: {
        kind: "agent",
        deliver: async () => ({
          identityFile: null,
          env: {},
          cleanup: () => void s.delivered.push({ key: "boom", cleaned: 1 }),
        }),
      },
    });
    await expect(boom.test({ targetId: vault.id, privateKey: PRIVATE })).rejects.toThrow(
      /spawn falhou/,
    );
    expect(s.delivered.at(-1)).toEqual({ key: "boom", cleaned: 1 });
  });
});
