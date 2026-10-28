import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { acquireLock, LOCK_FILE } from "../src/lock.ts";
import { type CliDeps, runCli } from "../src/main.ts";
import { tempDir } from "./helpers.ts";

function config() {
  const dir = tempDir();
  const dataDir = join(dir, "data");
  const file = join(dir, "config.json");
  writeFileSync(file, JSON.stringify({ port: 0, token: "t".repeat(32), dataDir }));
  return { file, dataDir };
}

function deps() {
  const exits: number[] = [];
  const errors: string[] = [];
  const cli: CliDeps = {
    env: {},
    log: { log: () => {}, error: (m) => errors.push(m) },
    exit: (code) => exits.push(code),
    onSignal: () => {},
  };
  return { cli, exits, errors };
}

describe("instancia-unica", () => {
  test("segundo daemon com o mesmo dataDir sai com código 3", async () => {
    const { file } = config();
    const first = deps();
    const daemon = await runCli(["--config", file, "--runtime", "fake"], first.cli);
    expect(daemon).not.toBeNull();

    const second = deps();
    expect(await runCli(["--config", file, "--runtime", "fake"], second.cli)).toBeNull();
    expect(second.exits).toEqual([3]);
    expect(second.errors.join("\n")).toContain("já em execução");

    await daemon?.stop();
    const third = deps();
    const again = await runCli(["--config", file, "--runtime", "fake"], third.cli);
    expect(third.exits).toEqual([]);
    await again?.stop();
  });

  test("lock de um processo que já morreu é retomado", async () => {
    const { dataDir } = config();
    const dead = Bun.spawn([process.execPath, "-e", "0"]);
    await dead.exited;
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, LOCK_FILE), String(dead.pid));

    const lock = acquireLock(dataDir);
    expect(lock).not.toBeNull();
    expect(acquireLock(dataDir)).toBeNull();
    lock?.release();
    expect(existsSync(join(dataDir, LOCK_FILE))).toBe(false);
    lock?.release();
  });

  test("lock com conteúdo ilegível é tratado como abandonado", () => {
    const { dataDir } = config();
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, LOCK_FILE), "lixo");
    const lock = acquireLock(dataDir);
    expect(lock).not.toBeNull();
    lock?.release();
  });
});
