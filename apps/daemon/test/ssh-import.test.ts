import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startServer } from "../src/server.ts";
import { SshImporter } from "../src/ssh/import.ts";
import { SshTargets } from "../src/ssh/targets.ts";
import { EventStore } from "../src/store/event-store.ts";
import { newManager, tempDir, workspace } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "ssh-import-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const CONFIG = `# my servers
Include conf.d/*.conf

Host vps
  HostName vps.example.com
  User deploy
  Port 2222
  IdentityFile ~/.ssh/id_ed25519

Host inner db
  HostName 10.0.0.9
  ProxyJump vps
  User=ana

Host *.internal
  User internal-user
  Port 2200

Host db.internal
  HostName db.internal

Host tok
  HostName %h.example.com

Host far
  HostName far.example.com
  ProxyJump bastion@bastion.example.com:2022

Host two
  HostName two.example.com
  ProxyJump vps,inner

Host loop-a
  HostName a.example.com
  ProxyJump loop-b

Host loop-b
  HostName b.example.com
  ProxyJump loop-a

Match host foo
  User nope

Host !bad *
  ForwardAgent no
  User fallback

Host *
  ServerAliveInterval 30
  User star
`;

/** A home with ~/.ssh/config, an Include with a CRLF file, and an Include that loops. */
function fixture() {
  const home = tempDir();
  const ssh = join(home, ".ssh");
  mkdirSync(join(ssh, "conf.d"), { recursive: true });
  const config = join(ssh, "config");
  writeFileSync(config, CONFIG);
  writeFileSync(
    join(ssh, "conf.d", "work.conf"),
    "Host work\r\n  HostName work.example.com\r\n  IdentityFile ~/.ssh/work\r\n",
  );
  writeFileSync(
    join(ssh, "conf.d", "loop.conf"),
    "Include conf.d/loop.conf\nHost looped\n  HostName l.example.com\n",
  );
  const store = new EventStore(":memory:");
  const targets = new SshTargets({ db: store.db });
  const importer = new SshImporter({ targets, configPath: config, home, defaultUser: "me" });
  return { home, ssh, config, targets, importer };
}

describe("ssh-import", () => {
  test("lê Host, HostName, User, Port, IdentityFile e ProxyJump, com Include, e só os nomes concretos viram destino", () => {
    const { importer } = fixture();
    const { entries } = importer.preview();
    expect(entries.map((e) => e.alias)).toEqual([
      "looped",
      "work",
      "vps",
      "inner",
      "db",
      "db.internal",
      "tok",
      "far",
      "two",
      "loop-a",
      "loop-b",
    ]);
    const by = (alias: string) => entries.find((e) => e.alias === alias);
    expect(by("vps")).toMatchObject({
      host: "vps.example.com",
      port: 2222,
      user: "deploy",
      identityFile: "~/.ssh/id_ed25519",
      proxyJump: null,
      exists: false,
    });
    expect(by("inner")).toMatchObject({
      host: "10.0.0.9",
      port: 22,
      user: "ana",
      identityFile: null,
      proxyJump: "vps",
    });
    // "Host inner db" is one block for two names.
    expect(by("db")).toMatchObject({ host: "10.0.0.9", user: "ana", proxyJump: "vps" });
    // The CRLF file from the Include.
    expect(by("work")).toMatchObject({
      host: "work.example.com",
      identityFile: "~/.ssh/work",
    });
  });

  test("os curingas viram padrão como no OpenSSH: o primeiro valor vence, na ordem do arquivo", () => {
    const { importer } = fixture();
    const { entries } = importer.preview();
    const by = (alias: string) => entries.find((e) => e.alias === alias);
    // *.internal comes before db.internal's own block, so its user and port win; the host is
    // db.internal's own.
    expect(by("db.internal")).toMatchObject({
      host: "db.internal",
      user: "internal-user",
      port: 2200,
    });
    // "Host !bad *" matches everything but "bad": it gives "work" a user, ahead of "Host *".
    expect(by("work")?.user).toBe("fallback");
    // vps has its own user; the wildcards do not override it.
    expect(by("vps")?.user).toBe("deploy");
    // A Match block is not applied, and no wildcard or negated pattern is a destino.
    expect(entries.some((e) => /[*?!]/.test(e.alias))).toBe(false);
    expect(entries.some((e) => e.user === "nope")).toBe(false);
  });

  test("sem User no arquivo, vale o usuário do sistema; sem arquivo, a prévia é vazia", () => {
    const { importer, config, home } = fixture();
    writeFileSync(config, "Host solo\n  HostName solo.example.com\n");
    expect(importer.preview().entries).toMatchObject([{ alias: "solo", user: "me" }]);
    const none = new SshImporter({
      targets: new SshTargets({ db: new EventStore(":memory:").db }),
      configPath: join(home, ".ssh", "nao-existe"),
      home,
      defaultUser: "me",
    });
    expect(none.preview()).toEqual({ entries: [] });
  });

  test("valores entre aspas perdem as aspas", () => {
    const { importer, config } = fixture();
    writeFileSync(
      config,
      ["Host quoted", '  HostName "q.example.com"', '  IdentityFile "~/.ssh/with space"', ""].join(
        "\n",
      ),
    );
    expect(importer.preview().entries).toMatchObject([
      { alias: "quoted", host: "q.example.com", identityFile: "~/.ssh/with space" },
    ]);
  });

  test("a prévia marca os destinos que já existem, pelo nome ou pelo mesmo host, porta e usuário", () => {
    const { importer, targets } = fixture();
    targets.save({ name: "vps", host: "outro.example.com", user: "x" });
    targets.save({ name: "meu-work", host: "work.example.com", user: "fallback" });
    const { entries } = importer.preview();
    const exists = entries.filter((e) => e.exists).map((e) => e.alias);
    expect(exists).toEqual(["work", "vps"]);
  });

  test("nada é escrito: nem no config, nem nas pastas, nem pela prévia nem pela aplicação", () => {
    const { importer, ssh, config } = fixture();
    const snapshot = () => ({
      config: readFileSync(config, "utf8"),
      mtime: statSync(config).mtimeMs,
      tree: readdirSync(ssh, { recursive: true }).sort(),
    });
    const before = snapshot();
    importer.preview();
    importer.apply(["vps", "inner"]);
    expect(snapshot()).toEqual(before);
  });

  test("aplicar cria só os escolhidos, o jump antes de quem passa por ele, e o IdentityFile vira key-file", () => {
    const { importer, targets } = fixture();
    const result = importer.apply(["inner", "vps", "work"]);
    expect(result.skipped).toEqual([]);
    const names = result.created.map((t) => t.name);
    expect(names.sort()).toEqual(["inner", "vps", "work"]);
    const vps = targets.list().find((t) => t.name === "vps");
    const inner = targets.list().find((t) => t.name === "inner");
    expect(inner?.jump).toBe(vps?.id ?? "nada");
    expect(vps).toMatchObject({ auth: "key-file", secretRef: "~/.ssh/id_ed25519", port: 2222 });
    expect(inner).toMatchObject({ auth: "agent", secretRef: null, host: "10.0.0.9", user: "ana" });
    expect(
      targets
        .list()
        .map((t) => t.name)
        .sort(),
    ).toEqual(["inner", "vps", "work"]);
  });

  test("o jump que já está cadastrado serve, mesmo sem ser escolhido de novo", () => {
    const { importer, targets } = fixture();
    importer.apply(["vps"]);
    const result = importer.apply(["inner"]);
    expect(result.skipped).toEqual([]);
    const vps = targets.list().find((t) => t.name === "vps");
    expect(result.created[0]?.jump).toBe(vps?.id ?? "nada");
  });

  test("não cria o que já existe, o que tem um jump que não é destino, vários jumps, ciclo ou valor inválido", () => {
    const { importer, targets } = fixture();
    importer.apply(["vps"]);
    const result = importer.apply([
      "vps",
      "far",
      "two",
      "inner",
      "loop-a",
      "loop-b",
      "tok",
      "nada",
    ]);
    const skipped = Object.fromEntries(result.skipped.map((s) => [s.alias, s.reason]));
    expect(skipped.vps).toMatch(/já existe/);
    expect(skipped.far).toMatch(/bastion@bastion\.example\.com:2022/);
    expect(skipped.two).toMatch(/vários/);
    // A ProxyJump that cannot be resolved is never dropped silently: the connection would go
    // straight to a host that may not be reachable that way.
    expect(targets.list().some((t) => t.name === "far" || t.name === "two")).toBe(false);
    expect(skipped["loop-a"]).toMatch(/ciclo/);
    expect(skipped["loop-b"]).toMatch(/ciclo/);
    expect(skipped.tok).toMatch(/invalid/);
    expect(skipped.nada).toMatch(/não está/);
    expect(result.created.map((t) => t.name)).toEqual(["inner"]);
  });

  test("pelo protocolo: ssh.import.preview e ssh.import.apply", async () => {
    const { importer, targets } = fixture();
    const { root } = workspace();
    const server = startServer({
      manager: newManager().manager,
      ssh: targets,
      sshImport: importer,
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
    const preview = await client.data<{ entries: Array<{ alias: string }> }>(
      "ssh.import.preview",
      {},
    );
    expect(preview?.entries.map((e) => e.alias)).toContain("vps");
    const applied = await client.data<{ created: Array<{ name: string }> }>("ssh.import.apply", {
      aliases: ["vps"],
    });
    expect(applied?.created.map((t) => t.name)).toEqual(["vps"]);
    expect((await client.request("ssh.import.apply", { aliases: "vps" })).error).toBeDefined();
  });

  test("sem o importador configurado, os comandos dizem que está desativado", async () => {
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
    const ack = await client.request("ssh.import.preview", {});
    expect((ack.error as { code?: string } | undefined)?.code).toBe("invalid_state");
  });
});
