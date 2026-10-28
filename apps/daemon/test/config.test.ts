import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import { parseArgs, runCli, startDaemon } from "../src/main.ts";
import { ClaudeSdkRuntime } from "../src/runtime/claude-sdk-runtime.ts";
import { tempDir } from "./helpers.ts";

describe("config", () => {
  test("primeira execução cria o arquivo com padrões e token aleatório", () => {
    const file = join(tempDir(), "sub", "config.json");
    const config = loadConfig(file);
    expect(existsSync(file)).toBe(true);
    expect(config.bind).toBe("127.0.0.1");
    expect(config.port).toBe(7420);
    expect(config.runtime).toBe("claude");
    expect(config.allowApiKey).toBe(false);
    expect(config.allowedRoots).toEqual([]);
    expect(config.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.parse(readFileSync(file, "utf8")).token).toBe(config.token);
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    // Second load reuses the same token.
    expect(loadConfig(file).token).toBe(config.token);
  });

  test("valida o arquivo existente e expande ~", () => {
    const file = join(tempDir(), "config.json");
    writeFileSync(file, JSON.stringify({ token: "x".repeat(32), dataDir: "~/fd", port: 9000 }));
    const config = loadConfig(file);
    expect(config.port).toBe(9000);
    expect(config.dataDir).not.toContain("~");
    writeFileSync(file, JSON.stringify({ token: "x".repeat(32), port: "nope" }));
    expect(() => loadConfig(file)).toThrow();
  });
});

describe("cli", () => {
  test("start é o comando padrão e aceita --config e --runtime", () => {
    expect(parseArgs([])).toEqual({ command: "start" });
    expect(parseArgs(["start", "--config", "c.json", "--runtime", "fake"])).toEqual({
      command: "start",
      config: "c.json",
      runtime: "fake",
    });
    expect(parseArgs(["--runtime=claude"])).toEqual({ command: "start", runtime: "claude" });
  });

  test("argumentos inválidos são recusados", () => {
    expect(() => parseArgs(["--runtime", "gpt"])).toThrow();
    expect(() => parseArgs(["deploy"])).toThrow();
    expect(() => parseArgs(["--config"])).toThrow();
  });
});

describe("daemon", () => {
  const writeConfig = (extra: Record<string, unknown> = {}) => {
    const dir = tempDir();
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({ port: 0, token: "t".repeat(32), dataDir: join(dir, "data"), ...extra }),
    );
    return { dir, file };
  };
  const silent = () => {
    const lines: string[] = [];
    return {
      lines,
      log: (msg: string) => lines.push(msg),
      error: (msg: string) => lines.push(msg),
    };
  };

  test("startDaemon sobe com runtime fake, avisa allowedRoots vazio e para", async () => {
    const { file } = writeConfig();
    const out = silent();
    const daemon = await startDaemon({ command: "start", config: file, runtime: "fake" }, {}, out);
    expect(daemon.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/v1\/ws$/);
    expect(out.lines.some((l) => l.includes("listening on"))).toBe(true);
    expect(out.lines.some((l) => l.includes("allowedRoots está vazio"))).toBe(true);
    expect(out.lines.join("\n")).not.toContain("t".repeat(32));
    const health = await fetch(daemon.url.replace("ws://", "http://").replace("/v1/ws", "/health"));
    expect(await health.json()).toEqual({ ok: true });
    await daemon.stop();
    await daemon.stop();
  });

  test("runtime claude é criado sem iniciar nenhuma sessão", async () => {
    const { file, dir } = writeConfig({ allowedRoots: ["."], claudePath: "claude-inexistente" });
    const out = silent();
    const daemon = await startDaemon({ command: "start", config: file }, {}, out);
    expect(daemon.runtime).toBeInstanceOf(ClaudeSdkRuntime);
    expect(out.lines.some((l) => l.includes("runtime=claude"))).toBe(true);
    expect(out.lines.some((l) => l.includes("allowedRoots está vazio"))).toBe(false);
    await daemon.stop();
    expect(dir).toBeTruthy();
  });

  test("runCli registra sinais que param o daemon e saem com 0", async () => {
    const { file } = writeConfig();
    const handlers = new Map<string, () => Promise<void>>();
    const exits: number[] = [];
    const daemon = await runCli(["--config", file, "--runtime", "fake"], {
      env: {},
      log: silent(),
      exit: (code) => exits.push(code),
      onSignal: (signal, handler) => handlers.set(signal, handler),
    });
    expect(daemon).not.toBeNull();
    expect([...handlers.keys()]).toEqual(["SIGINT", "SIGTERM"]);
    await handlers.get("SIGTERM")?.();
    expect(exits).toEqual([0]);
  });

  test("runCli com argumento inválido loga o erro e sai com 1", async () => {
    const out = silent();
    const exits: number[] = [];
    const daemon = await runCli(["--bogus"], {
      env: {},
      log: out,
      exit: (code) => exits.push(code),
      onSignal: () => {},
    });
    expect(daemon).toBeNull();
    expect(exits).toEqual([1]);
    expect(out.lines[0]).toContain("argumento desconhecido");
  });
});
