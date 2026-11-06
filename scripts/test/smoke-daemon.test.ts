import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DAEMON_START_MS, readListenUrl } from "../lib/smoke-daemon.ts";

const encoder = new TextEncoder();
const ROOT = resolve(import.meta.dir, "../..");

/** A stdout that gives these chunks and then ends, or stays open when `open` is true. */
function stdout(chunks: string[], open = false): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      if (!open) controller.close();
    },
  });
}

const failure = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
    return "";
  } catch (error) {
    return (error as Error).message;
  }
};

describe("smoke-daemon: waiting for the daemon to announce its port", () => {
  test("the address is the one after 'listening on', even when the line comes in pieces", async () => {
    const url = await readListenUrl(
      stdout([
        "aviso\nflightdeckd 0.36.4 listen",
        "ing on ws://127.0.0.1:4242/v1/ws (runtime=fake)\n",
      ]),
    );
    expect(url).toBe("ws://127.0.0.1:4242/v1/ws");
  });

  test("a daemon that ends without announcing fails with what it printed", async () => {
    const message = await failure(readListenUrl(stdout(["erro: porta ocupada\n"])));
    expect(message).toContain("daemon saiu sem anunciar a porta");
    expect(message).toContain("erro: porta ocupada");
  });

  test("a daemon that stays silent fails at the limit, naming the wait and what was printed", async () => {
    const message = await failure(readListenUrl(stdout(["carregando\n"], true), 40));
    expect(message).toMatch(/^timeout: daemon anunciar a porta/);
    expect(message).toContain("40 ms");
    expect(message).toContain("carregando");
  });

  test("the default limit is the measured one: a cold Windows runner has taken 17 s, the median is 1.2 s", () => {
    expect(DAEMON_START_MS).toBe(30_000);
  });
});

describe("smoke-daemon: every smoke waits the same way", () => {
  test("no smoke keeps its own copy of the reader or puts its generic step limit on the daemon start", () => {
    const own = readdirSync(join(ROOT, "scripts"))
      .filter((name) => /^smoke.*\.ts$/.test(name))
      .filter((name) => {
        const source = readFileSync(join(ROOT, "scripts", name), "utf8");
        return (
          /function readListenUrl/.test(source) || /withTimeout\(\s*readListenUrl/.test(source)
        );
      });
    expect(own).toEqual([]);
  });
});
