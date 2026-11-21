import { afterAll, describe, expect, test } from "bun:test";
import { rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { realTempDir } from "../../../../scripts/test/temp-dir.ts";
import { actionSaveNote, readDefinitionFile } from "../../src/permissions/action-save-note.ts";

const CWD = resolve("/work/proj");
const DEFINITION = JSON.stringify({
  name: "deploy",
  run: ["deploy.sh"],
  cwd: "/srv",
  env: { T: "{{secret.tok}}" },
});

/** A reader over fixed files that records what it was asked for. */
function files(content: Record<string, string>) {
  const asked: string[] = [];
  return {
    asked,
    read: async (path: string) => {
      asked.push(path);
      return content[path] ?? null;
    },
  };
}

describe("actionSaveNote: the request to save an action carries what the file holds (#3752)", () => {
  test("it reads the file the command names, from the session's folder, and says what it saves", async () => {
    const fake = files({ [resolve(CWD, "d.json")]: DEFINITION });
    const note = await actionSaveNote("fd action save --definition-file d.json", CWD, fake.read);
    expect(fake.asked).toEqual([resolve(CWD, "d.json")]);
    expect(note).toBe(
      `saves d.json (read in ${CWD}): name "deploy"; run ["deploy.sh"]; cwd "/srv"; env T; secrets tok`,
    );
  });

  test("an absolute path is read as it is", async () => {
    const fake = files({ [resolve("/tmp/x.json")]: DEFINITION });
    await actionSaveNote("fd action save --definition-file /tmp/x.json", CWD, fake.read);
    expect(fake.asked).toEqual([resolve("/tmp/x.json")]);
  });

  test("an absolute path says no folder, since the folder does not matter for it", async () => {
    const fake = files({ [resolve("/tmp/x.json")]: DEFINITION });
    const note = await actionSaveNote(
      "fd action save --definition-file /tmp/x.json",
      CWD,
      fake.read,
    );
    expect(note?.startsWith("saves /tmp/x.json: ")).toBe(true);
  });

  test("a step before the save that may change the file is said, and a lone save has no such word", async () => {
    const fake = files({ [resolve(CWD, "d.json")]: DEFINITION });
    const [lone, other] = await Promise.all([
      actionSaveNote("fd action save --definition-file d.json", CWD, fake.read),
      actionSaveNote(
        "cp evil.json d.json && fd action save --definition-file d.json",
        CWD,
        fake.read,
      ),
    ]);
    expect([lone?.includes("other steps"), other?.includes("other steps")]).toEqual([false, true]);
    expect(other).toContain("deny it unless you know what they do");
  });

  test("a file that cannot be read still gets a note that says so", async () => {
    const note = await actionSaveNote(
      "fd action save --definition-file gone.json",
      CWD,
      files({}).read,
    );
    expect(note).toContain("gone.json: its content could not be shown");
  });

  test("a reader that throws is the same as a file that cannot be read", async () => {
    const note = await actionSaveNote("fd action save --definition-file d.json", CWD, () =>
      Promise.reject(new Error("boom")),
    );
    expect(note).toContain("its content could not be shown");
  });

  test("a save with no file named says the line names none", async () => {
    const note = await actionSaveNote("fd action save", CWD, files({}).read);
    expect(note).toContain("no definition file was found in the command");
  });

  test("two saves in a line are two sentences, each with its own file", async () => {
    const fake = files({
      [resolve(CWD, "a.json")]: DEFINITION,
      [resolve(CWD, "b.json")]: JSON.stringify({ name: "other", run: ["x"], env: {} }),
    });
    const note = await actionSaveNote(
      "fd action save --definition-file a.json && fd action save --definition-file b.json",
      CWD,
      fake.read,
    );
    expect(note?.split(" | ")).toHaveLength(2);
    expect(note).toContain("saves a.json");
    expect(note).toContain("saves b.json");
  });

  test("past five saves the rest are counted, not read", async () => {
    const line = Array.from(
      { length: 8 },
      (_, i) => `fd action save --definition-file f${i}.json`,
    ).join("; ");
    const fake = files({});
    const note = await actionSaveNote(line, CWD, fake.read);
    expect(fake.asked).toHaveLength(5);
    expect(note).toContain("3 more saves in this command were not read");
  });

  test("a command with no save has no note, and starts no read", () => {
    const fake = files({});
    expect([
      actionSaveNote("fd action list --json", CWD, fake.read),
      actionSaveNote("ls -la", CWD, fake.read),
      actionSaveNote("fd action trust deploy --hash abc", CWD, fake.read),
    ]).toEqual([undefined, undefined, undefined]);
    expect(fake.asked).toEqual([]);
  });
});

describe("readDefinitionFile: only a small regular file is read (#3752)", () => {
  const dir = realTempDir("fd-save-note-");
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const put = (name: string, content: string) => {
    const path = join(dir, name);
    writeFileSync(path, content);
    return path;
  };

  test("a regular file is its text, emoji included", async () => {
    expect(await readDefinitionFile(put("ok.json", '{"name":"🙂"}'))).toBe('{"name":"🙂"}');
  });

  test("a missing file and a folder are null", async () => {
    expect([
      await readDefinitionFile(join(dir, "nope.json")),
      await readDefinitionFile(dir),
    ]).toEqual([null, null]);
  });

  test("a file at the limit is read and one byte over is null", async () => {
    const limit = 256 * 1024;
    expect((await readDefinitionFile(put("at.json", "a".repeat(limit))))?.length).toBe(limit);
    expect(await readDefinitionFile(put("over.json", "a".repeat(limit + 1)))).toBeNull();
  });

  test.skipIf(process.platform === "win32")(
    "a named pipe is null at once: opening it would wait for a writer",
    async () => {
      const pipe = join(dir, "pipe.json");
      Bun.spawnSync(["mkfifo", pipe]);
      expect(await readDefinitionFile(pipe)).toBeNull();
      rmSync(dir, { recursive: true, force: true });
    },
  );
});
