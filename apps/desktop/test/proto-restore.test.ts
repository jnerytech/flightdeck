import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../..");

describe("proto-restore: DOM prototypes patched by a test file are put back after it", () => {
  test("two files that patch HTMLElement.prototype and never restore it do not see each other's patch", async () => {
    const proc = Bun.spawn(
      [
        process.execPath,
        "--config=bunfig.area.toml",
        "test",
        "./apps/desktop/test/proto-leak/leak-a.test.tsx",
        "./apps/desktop/test/proto-leak/leak-b.test.tsx",
      ],
      { cwd: ROOT, stdout: "pipe", stderr: "pipe", env: { ...process.env, CLAUDECODE: "" } },
    );
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect({ code, summary: `${out}${err}`.match(/\d+ (?:pass|fail)/g) }).toEqual({
      code: 0,
      summary: ["2 pass", "0 fail"],
    });
  });
});
