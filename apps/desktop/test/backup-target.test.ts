import { describe, expect, test } from "bun:test";
import {
  type BackupFolder,
  type BackupTarget,
  folderTarget,
  keepNewest,
} from "../src/lib/backup-target.ts";

/**
 * Issue #1444: a backup target puts, lists, gets and removes backups by name. The folder of #1264
 * implements it; keeping the newest N is written once, over any target.
 */
const NAME = (day: number) =>
  `flightdeck-backup-202611${String(day).padStart(2, "0")}-120000.fdbackup`;

function memoryTarget(names: string[], fail: { list?: boolean; removeAt?: string } = {}) {
  const files = new Map(names.map((name) => [name, "text"]));
  const removed: string[] = [];
  const target: BackupTarget = {
    put: async (name, text) => {
      files.set(name, text);
    },
    list: async () => {
      if (fail.list) throw new Error("offline");
      return [...files.keys()];
    },
    get: async (name) => files.get(name) ?? "",
    remove: async (name) => {
      if (name === fail.removeAt) throw new Error("denied");
      files.delete(name);
      removed.push(name);
    },
  };
  return { target, files, removed };
}

describe("folderTarget", () => {
  test("puts, lists and removes through the folder and cannot read a file back", async () => {
    const written = new Map<string, string>();
    const folder: BackupFolder = {
      pick: async () => "/b",
      current: async () => "/b",
      write: async (name, text) => {
        written.set(name, text);
      },
      list: async () => [...written.keys()],
      remove: async (name) => {
        written.delete(name);
      },
    };
    const target = folderTarget(folder);
    await target.put(NAME(1), "cipher");
    expect(written.get(NAME(1))).toBe("cipher");
    expect(await target.list()).toEqual([NAME(1)]);
    await expect(target.get(NAME(1))).rejects.toThrow("unsupported");
    await target.remove(NAME(1));
    expect(await target.list()).toEqual([]);
  });
});

describe("keepNewest", () => {
  test("removes the oldest others so the protected file and the newest keep-1 stay", async () => {
    const { target, files, removed } = memoryTarget([NAME(1), NAME(2), NAME(3), NAME(4), NAME(9)]);
    const report = await keepNewest(target, 3, NAME(9));
    expect(report).toEqual({ ok: true, kept: 3, removed: 2 });
    expect(removed).toEqual([NAME(1), NAME(2)]);
    expect([...files.keys()].sort((a, b) => a.localeCompare(b))).toEqual([
      NAME(3),
      NAME(4),
      NAME(9),
    ]);
  });

  test("keeps the protected file even when it is older than the others", async () => {
    const { target, files } = memoryTarget([NAME(5), NAME(6), NAME(1)]);
    const report = await keepNewest(target, 2, NAME(1));
    expect(report).toEqual({ ok: true, kept: 2, removed: 1 });
    expect(files.has(NAME(1))).toBe(true);
    expect(files.has(NAME(6))).toBe(true);
  });

  test("leaves a file that is not named like a backup alone", async () => {
    const { target, files } = memoryTarget([NAME(1), "notes.txt", NAME(2)]);
    const report = await keepNewest(target, 1, NAME(2));
    expect(report).toEqual({ ok: true, kept: 1, removed: 1 });
    expect(files.has("notes.txt")).toBe(true);
  });

  test("removes nothing when there are fewer than keep", async () => {
    const { target, removed } = memoryTarget([NAME(1)]);
    expect(await keepNewest(target, 5, NAME(1))).toEqual({ ok: true, kept: 1, removed: 0 });
    expect(removed).toEqual([]);
  });

  test("says the prune failed when the list cannot be read", async () => {
    const { target } = memoryTarget([NAME(1), NAME(2)], { list: true });
    expect(await keepNewest(target, 1, NAME(2))).toEqual({ ok: false, removed: 0 });
  });

  test("stops at a removal that fails and counts what was removed before it", async () => {
    const { target, removed } = memoryTarget([NAME(1), NAME(2), NAME(3), NAME(9)], {
      removeAt: NAME(2),
    });
    expect(await keepNewest(target, 1, NAME(9))).toEqual({ ok: false, removed: 1 });
    expect(removed).toEqual([NAME(1)]);
  });
});
