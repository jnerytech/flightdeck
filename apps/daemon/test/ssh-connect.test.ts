import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import { startServer } from "../src/server.ts";
import { processRun, resolveSshPath, SshConnector } from "../src/ssh/connect.ts";
import { HostKeys } from "../src/ssh/hostkey.ts";
import {
  type AgentOps,
  chooseDelivery,
  createAgentDelivery,
  createFileDelivery,
  type DeliveredKey,
  processOps,
} from "../src/ssh/key-delivery.ts";
import { SshTargets } from "../src/ssh/targets.ts";
import { EventStore } from "../src/store/event-store.ts";
import { TerminalManager } from "../src/terminal/terminal-manager.ts";
import { newManager, tempDir, workspace } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";
import { fakePtys } from "./pty-helpers.ts";
import { manualTime } from "./time-helpers.ts";

const TOKEN = "ssh-connect-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

// Keys generated for the tests; never one of the user's.
const KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPHyii7r5lIz9AQ/c2vlfTxoKQtFoDLtWtwxRY/fF9Fl";
const NEW_KEY = `ssh-ed25519 ${Buffer.from("another-server-key-0123456789").toString("base64")}`;
const PRIVATE =
  "-----BEGIN OPENSSH PRIVATE KEY-----\nTEST-ONLY-NOT-A-REAL-KEY-7f3a\n-----END OPENSSH PRIVATE KEY-----";

const scan = (host: string, key: string) => ({ code: 0, stdout: `${host} ${key}\n` });
const code = async (fn: () => unknown): Promise<string> => {
  try {
    await fn();
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? "sem código";
  }
};

interface SetupOptions {
  platform?: NodeJS.Platform;
  dir?: string;
  askpass?: boolean;
}

function setup(options: SetupOptions = {}) {
  const dir = options.dir ?? tempDir();
  const store = new EventStore(":memory:");
  const targets = new SshTargets({ db: store.db });
  // What each host answers to ssh-keyscan; a host that is not here is unreachable.
  const servers = new Map<string, { code: number; stdout: string }>();
  const hostKeys = new HostKeys({
    targets,
    exec: async (cmd) => servers.get(cmd.at(-1) as string) ?? { code: 1, stdout: "" },
  });
  const time = manualTime();
  const ptys = fakePtys();
  const logs: string[] = [];
  const terminals = new TerminalManager({
    pty: ptys.factory,
    allowedRoots: [],
    platform: "linux",
    env: () => ({ PATH: "/bin" }),
    timers: time.timers,
    now: time.now,
    log: (line) => logs.push(line),
  });
  cleanups.push(() => terminals.stop());
  const runs: Array<{ argv: string[]; env: Record<string, string> }> = [];
  let reply = { code: 0, stderr: "" };
  const delivered: Array<{ key: string; cleaned: number }> = [];
  const tickets: Array<[string, string]> = [];
  const connector = new SshConnector({
    targets,
    hostKeys,
    terminals,
    dir,
    platform: options.platform ?? "linux",
    sshPath: "/usr/bin/ssh",
    timers: time.timers,
    run: async (argv, env) => {
      runs.push({ argv, env });
      return reply;
    },
    delivery: {
      kind: "agent",
      deliver: async (key): Promise<DeliveredKey> => {
        const record = { key, cleaned: 0 };
        delivered.push(record);
        return {
          identityFile: null,
          env: { SSH_AUTH_SOCK: "/tmp/fd-test.sock" },
          cleanup: () => {
            record.cleaned++;
          },
        };
      },
    },
    ...(options.askpass === false
      ? {}
      : {
          askpass: {
            script: "/data/ssh/askpass.sh",
            configFile: "/home/u/.flightdeck/config.json",
            ticket: (target: { name: string }, kind: string) => {
              tickets.push([target.name, kind]);
              return "ticket-1";
            },
          },
        }),
  });
  cleanups.push(() => connector.stop());
  const bastion = targets.save({ name: "bastion", host: "bastion.example.com", user: "jump" });
  const inner = targets.save({ name: "inner", host: "10.0.0.9", user: "ana", jump: bastion.id });
  const vps = targets.save({
    name: "vps",
    host: "vps.example.com",
    user: "deploy",
    port: 2222,
  });
  const pin = (id: string, key = KEY) =>
    targets.pin(id, { fingerprint: `SHA256:${id.slice(-6)}`, keys: [key] });
  for (const t of [bastion, inner, vps]) {
    pin(t.id);
    servers.set(t.host, scan(t.host, KEY));
  }
  return {
    dir,
    targets,
    terminals,
    connector,
    ptys,
    time,
    logs,
    delivered,
    tickets,
    servers,
    runs,
    answer: (code: number, stderr = "") => {
      reply = { code, stderr };
    },
    pin,
    bastion,
    inner,
    vps,
    open: (id: string, extra: { privateKey?: string } = {}) =>
      connector.connect({ targetId: id, cols: 100, rows: 30, ...extra }),
    probe: (id: string, extra: { privateKey?: string } = {}) =>
      connector.test({ targetId: id, ...extra }),
  };
}

/** The ssh argv that was started, with the generated files' paths named. */
function started(s: ReturnType<typeof setup>, index = 0) {
  const pty = s.ptys.spawned[index];
  if (!pty) throw new Error("nenhum terminal aberto");
  const value = (flag: string, prefix = "") => {
    const at = pty.argv.findIndex(
      (word, i) => i > 0 && pty.argv[i - 1] === flag && word.startsWith(prefix),
    );
    return pty.argv[at]?.slice(prefix.length).replace(/^"|"$/g, "") ?? "";
  };
  return {
    pty,
    argv: pty.argv,
    config: value("-F"),
    knownHosts: value("-o", "UserKnownHostsFile="),
  };
}

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
    s.connector.stop();
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
    const translated: Array<[string, string, string | undefined, object | undefined]> = [
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
          cleanup: () => s.delivered.push({ key: "boom", cleaned: 1 }),
        }),
      },
    });
    await expect(boom.test({ targetId: vault.id, privateKey: PRIVATE })).rejects.toThrow(
      /spawn falhou/,
    );
    expect(s.delivered.at(-1)).toEqual({ key: "boom", cleaned: 1 });
  });

  test("pelo protocolo: ssh.connect devolve o terminal e ssh.test o resultado do teste", async () => {
    const s = setup();
    const { root } = workspace();
    const server = startServer({
      manager: newManager().manager,
      ssh: s.targets,
      sshConnect: s.connector,
      terminals: s.terminals,
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
    const info = await client.data<{ terminalId: string; command: string }>("ssh.connect", {
      targetId: s.vps.id,
      cols: 100,
      rows: 30,
    });
    expect(info?.command).toBe("ssh");
    expect(s.terminals.list().map((t) => t.terminalId)).toEqual([info?.terminalId ?? ""]);
    expect(await client.data("ssh.test", { targetId: s.vps.id })).toEqual({
      ok: true,
      error: null,
    });
    const bad = await client.request("ssh.connect", {
      targetId: s.vps.id,
      cols: 100,
      rows: 30,
      extra: 1,
    });
    expect((bad.error as { code?: string } | undefined)?.code).toBe("bad_request");
  });

  test("sem o conector configurado, ssh.connect diz que está desativado", async () => {
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
    const ack = await client.request("ssh.connect", { targetId: "x", cols: 80, rows: 24 });
    expect((ack.error as { code?: string } | undefined)?.code).toBe("invalid_state");
  });
});

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
        deliver: async () => ({ identityFile: null, env: {}, cleanup: () => cleaned++ }),
      },
    });
    await real.connect({ targetId: target.id, cols: 80, rows: 24, privateKey: PRIVATE });
    expect(cleaned).toBe(0);
    real.stop();
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

  test("a config pode apontar o ssh a usar, e um caminho vazio é recusado", () => {
    const write = (ssh: unknown) => {
      const file = join(tempDir(), "config.json");
      writeFileSync(file, JSON.stringify({ token: "t".repeat(32), ssh }));
      return file;
    };
    expect(loadConfig(write({ path: "/opt/openssh/ssh" })).ssh.path).toBe("/opt/openssh/ssh");
    expect(loadConfig(write({})).ssh.path).toBeUndefined();
    expect(() => loadConfig(write({ path: "" }))).toThrow();
  });

  test("o ssh de verdade: o System32 no Windows quando existe, senão o do PATH, senão só ssh", () => {
    const system32 = `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\OpenSSH\\ssh.exe`;
    const both = { exists: (path: string) => path === system32, which: () => "/x/ssh" };
    expect(resolveSshPath({ platform: "win32", ...both })).toBe(system32);
    expect(
      resolveSshPath({ platform: "win32", exists: () => false, which: () => "C:\\Git\\ssh.exe" }),
    ).toBe("C:\\Git\\ssh.exe");
    expect(resolveSshPath({ platform: "linux", ...both })).toBe("/x/ssh");
    expect(resolveSshPath({ platform: "linux", exists: () => false, which: () => null })).toBe(
      "ssh",
    );
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
    delivered.cleanup();
    expect(readdirSync(dir).filter((name) => name.includes("abc123"))).toEqual([]);
    // Cleaning again, or after the file is gone, is fine.
    delivered.cleanup();
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
    delivered.cleanup();
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
    delivered.cleanup();
    delivered.cleanup();
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
