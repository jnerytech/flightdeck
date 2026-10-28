import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import { parseArgs } from "../src/main.ts";
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
