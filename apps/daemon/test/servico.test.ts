import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { loadConfig } from "../src/config.ts";
import { type CliDeps, parseArgs, runCli, startDaemon } from "../src/main.ts";
import { type ServiceContext, systemdUnit, windowsTaskXml } from "../src/service.ts";
import { osServiceContext } from "../src/service-os.ts";
import { tempDir } from "./helpers.ts";

const stops: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});

function fakeOs(platform: "linux" | "win32" | "darwin", which: Record<string, string> = {}) {
  const calls: string[][] = [];
  const written = new Map<string, string>();
  const removed: string[] = [];
  const ctx = (dryRun: boolean): ServiceContext => ({
    platform,
    home: platform === "win32" ? "C:\\Users\\dev" : "/home/dev",
    user: platform === "win32" ? "PC\\dev" : "dev",
    command: [
      platform === "win32"
        ? "C:\\Users\\dev\\bin\\flightdeckd.exe"
        : "/home/dev/.local/bin/flightdeckd",
    ],
    systemRoot: "C:\\Windows",
    tempDir: platform === "win32" ? "C:\\Temp" : "/tmp",
    dryRun,
    exec: async (cmd) => {
      calls.push(cmd);
      if (cmd[0] === "loginctl") return { code: 0, stdout: "Linger=yes\n" };
      if (cmd.includes("is-active")) return { code: 0, stdout: "active\n" };
      if (cmd.includes("/Query")) return { code: 0, stdout: "Flightdeck\\flightdeckd  Pronto\n" };
      return { code: 0, stdout: "" };
    },
    writeFile: (path, content) => {
      written.set(path, content);
    },
    removeFile: (path) => {
      removed.push(path);
    },
    which: (name) => which[name] ?? null,
  });
  return { ctx, calls, written, removed };
}

function cli(os: ReturnType<typeof fakeOs>) {
  const out: string[] = [];
  const exits: number[] = [];
  const deps: CliDeps = {
    env: {},
    log: { log: (m) => out.push(m), error: (m) => out.push(m) },
    exit: (code) => exits.push(code),
    onSignal: () => {},
    serviceContext: os.ctx,
  };
  return { deps, out, exits };
}

function configFile(content?: object) {
  const file = join(tempDir(), "config.json");
  if (content) writeFileSync(file, JSON.stringify(content, null, 2));
  return file;
}

describe("servico", () => {
  test("parseArgs entende service <ação> e --dry-run", () => {
    // Errors become values, so a parser that rejects the command fails the assertion.
    const parse = (argv: string[]) => {
      try {
        return parseArgs(argv);
      } catch (error) {
        return String(error);
      }
    };
    expect(parse(["service", "install", "--dry-run", "--config", "c.json"])).toEqual({
      command: "service",
      action: "install",
      dryRun: true,
      config: "c.json",
    });
    expect(parse(["service", "status"])).toEqual({ command: "service", action: "status" });
  });

  test("install --dry-run no Linux imprime a unit e os comandos sem executar, gravar nem criar a config", async () => {
    const os = fakeOs("linux", { claude: "/home/dev/.local/bin/claude" });
    const { deps, out, exits } = cli(os);
    const file = configFile();
    await runCli(["service", "install", "--dry-run", "--config", file], deps);
    expect(exits).toEqual([0]);
    const text = out.join("\n");
    expect(text).toContain(systemdUnit(["/home/dev/.local/bin/flightdeckd"]));
    expect(text).toContain("/home/dev/.config/systemd/user/flightdeckd.service");
    expect(text).toContain("systemctl --user enable --now flightdeckd");
    expect(text).toContain('claude.executablePath = "/home/dev/.local/bin/claude"');
    expect(os.calls).toEqual([]);
    expect(os.written.size).toBe(0);
    expect(existsSync(file)).toBe(false);
  });

  test("install --dry-run no Windows imprime o XML e o comando da tarefa sem tocar na config", async () => {
    const os = fakeOs("win32");
    const { deps, out, exits } = cli(os);
    const file = configFile({ token: "t".repeat(32) });
    const before = readFileSync(file, "utf8");
    await runCli(["service", "install", "--dry-run", "--config", file], deps);
    expect(exits).toEqual([0]);
    const text = out.join("\n");
    expect(text).toContain(
      'schtasks /Create /TN "Flightdeck\\flightdeckd" /XML C:\\Temp\\flightdeckd-task.xml /F',
    );
    expect(text).toContain(
      windowsTaskXml(["C:\\Users\\dev\\bin\\flightdeckd.exe"], {
        user: "PC\\dev",
        systemRoot: "C:\\Windows",
      }),
    );
    expect(text).toContain("claude não encontrado no PATH");
    expect(os.calls).toEqual([]);
    expect(os.written.size).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  test("install no Windows grava o XML, cria a tarefa e registra o claude.exe na config", async () => {
    const os = fakeOs("win32", {
      "claude.exe": "C:\\Users\\dev\\.local\\bin\\claude.exe",
      claude: "C:\\npm\\claude.cmd",
    });
    const { deps, exits } = cli(os);
    const file = configFile({ token: "t".repeat(32), allowedRoots: ["C:\\code"] });
    await runCli(["service", "install", "--config", file], deps);
    expect(exits).toEqual([0]);
    expect(os.written.get("C:\\Temp\\flightdeckd-task.xml")).toContain(
      "<RunLevel>LeastPrivilege</RunLevel>",
    );
    expect(os.calls).toEqual([
      [
        "schtasks",
        "/Create",
        "/TN",
        "Flightdeck\\flightdeckd",
        "/XML",
        "C:\\Temp\\flightdeckd-task.xml",
        "/F",
      ],
    ]);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.claude).toEqual({ executablePath: "C:\\Users\\dev\\.local\\bin\\claude.exe" });
    expect(saved.allowedRoots).toEqual(["C:\\code"]);
    expect(saved.token).toBe("t".repeat(32));
  });

  test("só o claude.cmd no Windows: grava e avisa", async () => {
    const os = fakeOs("win32", { claude: "C:\\npm\\claude.cmd" });
    const { deps, out } = cli(os);
    const file = configFile({ token: "t".repeat(32) });
    await runCli(["service", "install", "--config", file], deps);
    expect(JSON.parse(readFileSync(file, "utf8")).claude?.executablePath ?? "").toBe(
      "C:\\npm\\claude.cmd",
    );
    expect(out.join("\n")).toContain("aviso: C:\\npm\\claude.cmd não é um .exe");
  });

  test("install no Linux instala a unit e registra o caminho do claude", async () => {
    const os = fakeOs("linux", { claude: "/usr/local/bin/claude" });
    const { deps, out, exits } = cli(os);
    const file = configFile({ token: "t".repeat(32) });
    await runCli(["service", "install", "--config", file], deps);
    expect(exits).toEqual([0]);
    expect(os.written.has("/home/dev/.config/systemd/user/flightdeckd.service")).toBe(true);
    expect(loadConfig(file).claude?.executablePath ?? "").toBe("/usr/local/bin/claude");
    expect(out.join("\n")).toContain("serviço flightdeckd habilitado e iniciado");
  });

  test("uninstall e status no Linux e no Windows", async () => {
    const linux = fakeOs("linux");
    const linuxCli = cli(linux);
    await runCli(["service", "uninstall"], linuxCli.deps);
    expect(linuxCli.exits).toEqual([0]);
    expect(linux.calls).toEqual([
      ["systemctl", "--user", "disable", "--now", "flightdeckd"],
      ["systemctl", "--user", "daemon-reload"],
    ]);
    expect(linux.removed).toEqual(["/home/dev/.config/systemd/user/flightdeckd.service"]);
    const status = cli(linux);
    await runCli(["service", "status"], status.deps);
    expect(status.out).toEqual(["active"]);

    const win = fakeOs("win32");
    await runCli(["service", "uninstall"], cli(win).deps);
    const winStatus = cli(win);
    await runCli(["service", "status"], winStatus.deps);
    expect(win.calls).toEqual([
      ["schtasks", "/Delete", "/TN", "Flightdeck\\flightdeckd", "/F"],
      ["schtasks", "/Query", "/TN", "Flightdeck\\flightdeckd"],
    ]);
    expect(winStatus.out).toEqual(["Flightdeck\\flightdeckd  Pronto"]);

    const dry = fakeOs("linux");
    const dryCli = cli(dry);
    await runCli(["service", "uninstall", "--dry-run"], dryCli.deps);
    expect(dry.calls).toEqual([]);
    expect(dry.removed).toEqual([]);
    expect(dryCli.out.join("\n")).toContain("systemctl --user disable --now flightdeckd");
  });

  test("status sem serviço instalado diz que não está instalado", async () => {
    const os = fakeOs("linux");
    const ctx = (dryRun: boolean) => ({
      ...os.ctx(dryRun),
      exec: async () => ({ code: 3, stdout: "" }),
    });
    const out: string[] = [];
    await runCli(["service", "status"], {
      ...cli(os).deps,
      log: { log: (m) => out.push(m), error: (m) => out.push(m) },
      serviceContext: ctx,
    });
    expect(out).toEqual(["não instalado"]);
  });

  test("sistema sem suporte e ação inválida saem com erro", async () => {
    const mac = cli(fakeOs("darwin"));
    await runCli(["service", "install", "--config", configFile()], mac.deps);
    expect(mac.exits).toEqual([1]);
    expect(mac.out.join("\n")).toContain("não suportado");
    const bad = cli(fakeOs("linux"));
    await runCli(["service", "explodir"], bad.deps);
    expect(bad.exits).toEqual([1]);
    expect(bad.out.join("\n")).toContain("ação de serviço inválida: explodir");
  });

  test("o daemon usa claude.executablePath da config, com prioridade sobre claudePath", async () => {
    const dir = tempDir();
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        port: 0,
        token: "t".repeat(32),
        dataDir: join(dir, "data"),
        claudePath: "/legado/claude",
        claude: { executablePath: "/nao/existe/claude" },
      }),
    );
    const daemon = await startDaemon(
      { command: "start", config: file, runtime: "claude" },
      {},
      { log: () => {}, error: () => {} },
    );
    stops.push(() => daemon.stop());
    expect((daemon.runtime as unknown as { claudePath?: string }).claudePath).toBe(
      "/nao/existe/claude",
    );
  });

  test("contexto real: dados do sistema e busca no PATH atual, sem executar nada ao ser criado", () => {
    const ctx = osServiceContext(true);
    expect(ctx.dryRun).toBe(true);
    expect(ctx.platform).toBe(process.platform);
    expect(ctx.home).toBe(homedir());
    expect(ctx.tempDir).toBe(tmpdir());
    expect(ctx.user.length).toBeGreaterThan(0);
    expect(ctx.command[0]).toBe(process.execPath);
    expect(ctx.which("bun")).not.toBeNull();
    expect(ctx.which("comando-que-nao-existe-123")).toBeNull();
    // The preload puts the claude sentinel first on PATH: the real context must find it.
    const guardDir = (process.env.PATH ?? "").split(delimiter)[0] ?? "";
    expect(ctx.which("claude")?.startsWith(guardDir)).toBe(true);
  });

  test("usuário do Windows vem como DOMÍNIO\\usuário", () => {
    const ctx = osServiceContext(false, {
      platform: "win32",
      env: { USERDOMAIN: "PC", USERNAME: "dev", SystemRoot: "D:\\Win" },
    });
    expect(ctx.user).toBe("PC\\dev");
    expect(ctx.systemRoot).toBe("D:\\Win");
    expect(osServiceContext(false, { platform: "win32", env: {} }).systemRoot).toBe("C:\\Windows");
  });

  test("contexto real: writeFile cria pastas, XML vai em UTF-16 com BOM, removeFile apaga, exec devolve a saída", async () => {
    const ctx = osServiceContext(false);
    const dir = tempDir();
    const unit = join(dir, "a", "b", "flightdeckd.service");
    ctx.writeFile(unit, "[Unit]\n");
    expect(existsSync(unit) && readFileSync(unit, "utf8")).toBe("[Unit]\n");
    const xml = join(dir, "task.xml");
    ctx.writeFile(xml, "<Task/>");
    const bytes = existsSync(xml) ? readFileSync(xml) : Buffer.alloc(0);
    expect([...bytes.subarray(0, 4)]).toEqual([0xff, 0xfe, 0x3c, 0x00]);
    expect(bytes.toString("utf16le").slice(1)).toBe("<Task/>");
    ctx.removeFile(unit);
    ctx.removeFile(unit);
    expect(existsSync(unit)).toBe(false);
    expect(await ctx.exec([process.execPath, "-e", "console.log('oi'); process.exit(4)"])).toEqual({
      code: 4,
      stdout: "oi\n",
    });
  });
});
