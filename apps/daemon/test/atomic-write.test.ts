import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { appendFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../src/atomic-write.ts";
import { liveReceptor } from "../src/central/wrapper.ts";
import { tempDir } from "./helpers.ts";

describe("atomic-write: a reader sees the old file or the new one, never half of it (issue #138)", () => {
  test("while a slow writer is between its two halves, the file still holds the old whole content", async () => {
    const dir = tempDir();
    const file = join(dir, "receptor.json");
    writeFileSync(file, JSON.stringify({ url: "http://127.0.0.1:1111" }));
    const seen: string[] = [];
    const whole = JSON.stringify({ url: "http://127.0.0.1:2222" });
    await writeFileAtomic(file, whole, {
      // A writer that stops between two parts, as a loaded disk or a slow runner does.
      write: async (path, data) => {
        const half = Math.floor(data.length / 2);
        writeFileSync(path, data.slice(0, half));
        seen.push(readFileSync(file, "utf8"));
        await appendFile(path, data.slice(half));
      },
      rename,
    });
    expect(seen.map((text) => JSON.parse(text))).toEqual([{ url: "http://127.0.0.1:1111" }]);
    expect(readFileSync(file, "utf8")).toBe(whole);
    expect(readdirSync(dir)).toEqual(["receptor.json"]);
  });
});

describe("atomic-write: Windows refuses a replace for a moment, so the rename is tried again", () => {
  const busy = (code: string) => Object.assign(new Error(code), { code });

  test("a rename that is busy twice succeeds the third time, and the content is the new one", async () => {
    const dir = tempDir();
    const file = join(dir, "a.json");
    writeFileSync(file, "old");
    let calls = 0;
    await writeFileAtomic(file, "new", {
      rename: async (from, to) => {
        calls++;
        if (calls < 3) throw busy(calls === 1 ? "EBUSY" : "EPERM");
        await rename(from, to);
      },
    });
    expect(calls).toBe(3);
    expect(readFileSync(file, "utf8")).toBe("new");
    expect(readdirSync(dir)).toEqual(["a.json"]);
  });

  test("a rename that stays busy gives up after six tries with its error, and leaves the old file and no temp file", async () => {
    const dir = tempDir();
    const file = join(dir, "a.json");
    writeFileSync(file, "old");
    let calls = 0;
    const error = await writeFileAtomic(file, "new", {
      rename: async () => {
        calls++;
        throw busy("EACCES");
      },
    }).catch((e: NodeJS.ErrnoException) => e);
    expect((error as NodeJS.ErrnoException).code).toBe("EACCES");
    expect(calls).toBe(6);
    expect(readFileSync(file, "utf8")).toBe("old");
    expect(readdirSync(dir)).toEqual(["a.json"]);
  });

  test("any other failure is not retried", async () => {
    const dir = tempDir();
    const file = join(dir, "a.json");
    let calls = 0;
    const error = await writeFileAtomic(file, "new", {
      rename: async () => {
        calls++;
        throw busy("ENOSPC");
      },
    }).catch((e: NodeJS.ErrnoException) => e);
    expect((error as NodeJS.ErrnoException).code).toBe("ENOSPC");
    expect(calls).toBe(1);
  });
});

describe("atomic-write: the reader of receptor.json is not caught by a half file either", () => {
  test("a half-written receptor file means no receptor yet, not a crash", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "receptor.json"), '{"url":"http://127.0.0');
    expect(existsSync(join(dir, "receptor.json"))).toBe(true);
    expect(await liveReceptor(dir, 200)).toBeNull();
  });
});

describe("atomic-write: a link and the mode of the file it replaces are kept (review of rc/0364, M1)", () => {
  test.skipIf(process.platform === "win32")(
    "a symlinked target stays a link and the file it points to gets the new content",
    async () => {
      const dir = tempDir();
      const real = join(dir, "dotfiles", "settings.json");
      const link = join(dir, "settings.json");
      mkdirSync(join(dir, "dotfiles"));
      writeFileSync(real, '{"old":true}');
      symlinkSync(real, link);
      await writeFileAtomic(link, '{"new":true}');
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      expect(readFileSync(real, "utf8")).toBe('{"new":true}');
      expect(readdirSync(join(dir, "dotfiles"))).toEqual(["settings.json"]);
    },
  );

  test.skipIf(process.platform === "win32")(
    "a file with mode 0600 is still 0600 after the write, and a new file follows the umask",
    async () => {
      const dir = tempDir();
      const file = join(dir, "settings.json");
      writeFileSync(file, "{}");
      chmodSync(file, 0o600);
      await writeFileAtomic(file, '{"a":1}');
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(readFileSync(file, "utf8")).toBe('{"a":1}');
      const fresh = join(dir, "fresh.json");
      await writeFileAtomic(fresh, "{}");
      expect(existsSync(fresh)).toBe(true);
    },
  );

  test.skipIf(process.platform === "win32")(
    "an explicit mode wins over the existing one",
    async () => {
      const dir = tempDir();
      const file = join(dir, "secret");
      writeFileSync(file, "x");
      chmodSync(file, 0o644);
      await writeFileAtomic(file, "y", { mode: 0o600 });
      expect(statSync(file).mode & 0o777).toBe(0o600);
    },
  );
});
