import { describe, expect, test } from "bun:test";
import { AsyncQueue } from "../src/async-queue.ts";
import { defaultConfigPath, expandHome } from "../src/config.ts";
import { ulid } from "../src/ulid.ts";

describe("util", () => {
  test("AsyncQueue entrega em ordem, para no break e ignora push depois do fim", async () => {
    const queue = new AsyncQueue<number>();
    queue.push(1);
    queue.push(2);
    const seen: number[] = [];
    for await (const n of queue) {
      seen.push(n);
      if (n === 2) break;
    }
    expect(seen).toEqual([1, 2]);
    expect(queue.isEnded).toBe(true);
    queue.push(3);
    queue.end();
    queue.fail(new Error("ignorado"));
    expect((await queue[Symbol.asyncIterator]().next()).done).toBe(true);
  });

  test("AsyncQueue acorda leitores no fim e propaga falha", async () => {
    const ended = new AsyncQueue<number>();
    const pending = ended[Symbol.asyncIterator]().next();
    ended.end();
    expect((await pending).done).toBe(true);

    const failed = new AsyncQueue<number>();
    const waiting = failed[Symbol.asyncIterator]().next();
    failed.fail(new Error("boom"));
    await expect(waiting).rejects.toThrow("boom");
    await expect(failed[Symbol.asyncIterator]().next()).rejects.toThrow("boom");
  });

  test("ulid é monotônico mesmo no mesmo milissegundo, inclusive com carry", () => {
    const ids = Array.from({ length: 2000 }, () => ulid(1_700_000_000_000));
    expect(ids.every((id) => /^[0-9A-HJKMNP-TV-Z]{26}$/.test(id))).toBe(true);
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("defaultConfigPath aponta para ~/.flightdeck/config.json", () => {
    expect(defaultConfigPath().replaceAll("\\", "/")).toEndWith(".flightdeck/config.json");
  });

  test("expandHome expande ~ sozinho e preserva outros caminhos", () => {
    expect(expandHome("~")).not.toBe("~");
    expect(expandHome("/abs/path")).toBe("/abs/path");
  });
});
