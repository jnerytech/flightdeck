import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SecretScanner } from "@flightdeck/protocol";
import { FileLog } from "../src/logs/file-log.ts";
import { tempDir } from "./helpers.ts";

const stamp = () => Date.parse("2026-11-05T12:00:00Z");
const make = (over: Partial<ConstructorParameters<typeof FileLog>[0]> = {}) => {
  const dir = join(tempDir("fd-logs-"), "logs");
  return { dir, log: new FileLog({ dir, scanner: new SecretScanner(), now: stamp, ...over }) };
};
const live = (dir: string) => readFileSync(join(dir, "flightdeckd.log"), "utf8");

afterEach(() => {});

describe("log-arquivo: the daemon's own log file (issue #255)", () => {
  test("a line is written with its time and level, in a folder made on demand", async () => {
    const { dir, log } = make();
    log.write("info", "listening on ws://127.0.0.1:7420");
    log.write("error", "something broke");
    await log.flush();
    expect(live(dir).split("\n").filter(Boolean)).toEqual([
      "2026-11-05T12:00:00.000Z INFO listening on ws://127.0.0.1:7420",
      "2026-11-05T12:00:00.000Z ERROR something broke",
    ]);
    expect(log.path()).toBe(join(dir, "flightdeckd.log"));
  });

  test("no secret ever reaches the file: every line is redacted first", async () => {
    const { dir, log } = make();
    const secrets = [
      "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      "Bearer abcdefghijklmnopqrstuvwxyz012345",
      "token=0123456789abcdef0123456789abcdef",
    ];
    for (const secret of secrets) log.write("info", `request with ${secret} done`);
    await log.flush();
    const text = live(dir);
    expect(text).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz");
    expect(text).not.toContain("abcdefghijklmnopqrstuvwxyz012345");
    expect(text).not.toContain("0123456789abcdef0123456789abcdef");
    expect(text.match(/\[redacted\]/g)).toHaveLength(3);
  });

  test("a message with new lines is one line, and an enormous one is cut", async () => {
    const { dir, log } = make();
    log.write("info", "line one\nline two\r\nline three");
    log.write("info", "x".repeat(10_000));
    await log.flush();
    const lines = live(dir).split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("line one line two line three");
    expect((lines[1] ?? "").length).toBeLessThan(2200);
  });

  test("at the size limit the file rotates: 5 files at most, the newest first", async () => {
    const { dir, log } = make({ maxBytes: 200, files: 3 });
    for (let i = 0; i < 40; i++) log.write("info", `message number ${i} with some padding to fill`);
    await log.flush();
    const names = readdirSync(dir).sort();
    expect(names).toEqual(["flightdeckd.log", "flightdeckd.log.1", "flightdeckd.log.2"]);
    expect(live(dir)).toContain("message number 39");
    expect(readFileSync(join(dir, "flightdeckd.log.1"), "utf8")).not.toContain("message number 39");
    expect(existsSync(join(dir, "flightdeckd.log.3"))).toBe(false);
  });

  test("tail gives the last lines across the rotated files, redacted again", async () => {
    const { dir, log } = make({ maxBytes: 200, files: 3 });
    for (let i = 0; i < 12; i++) log.write("info", `n${i}`);
    await log.flush();
    const last = await log.tail(5);
    expect(last).toHaveLength(5);
    expect(last.at(-1)).toContain("n11");
    expect(last[0]).toContain("n7");
    // A secret that got into the file some other way is still not handed out.
    writeFileSync(
      join(dir, "flightdeckd.log"),
      "2026 INFO leaked ghp_abcdefghijklmnopqrstuvwxyz0123456789\n",
    );
    expect((await log.tail(5)).join("\n")).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz");
  });

  test("tail is bounded: 500 lines at most, whatever is asked, and a missing folder is empty", async () => {
    const { log } = make();
    for (let i = 0; i < 700; i++) log.write("info", `n${i}`);
    await log.flush();
    expect(await log.tail(10_000)).toHaveLength(500);
    expect(await log.tail(0)).toEqual([]);
    const fresh = make();
    expect(await fresh.log.tail(5)).toEqual([]);
  });

  test("a folder that cannot be written does not stop the daemon", async () => {
    const { log } = make({ dir: "/proc/nonexistent/logs" });
    expect(() => log.write("info", "still running")).not.toThrow();
    await log.flush();
    log.write("info", "and again");
    await expect(log.flush()).resolves.toBeUndefined();
  });

  test("write never blocks: nothing is on the disk when it returns, and the lines land in order after flush", async () => {
    const { dir, log } = make();
    for (let i = 0; i < 50; i++) log.write("info", `n${i}`);
    expect(existsSync(join(dir, "flightdeckd.log"))).toBe(false);
    await log.flush();
    const lines = live(dir).split("\n").filter(Boolean);
    expect(lines.map((l) => l.split(" INFO ")[1])).toEqual(
      Array.from({ length: 50 }, (_, i) => `n${i}`),
    );
  });

  test("a failed write does not stop the lines after it", async () => {
    const { dir, log } = make();
    log.write("info", "first");
    await log.flush();
    rmSync(join(dir, "flightdeckd.log"));
    mkdirSync(join(dir, "flightdeckd.log"));
    log.write("info", "lost");
    await log.flush();
    rmSync(join(dir, "flightdeckd.log"), { recursive: true });
    log.write("info", "third");
    await log.flush();
    expect(live(dir)).toContain("third");
  });

  test("tail waits for the lines still queued, so a reader sees what was just written", async () => {
    const { log } = make();
    log.write("info", "just written");
    expect((await log.tail(5)).join("\n")).toContain("just written");
  });
});
