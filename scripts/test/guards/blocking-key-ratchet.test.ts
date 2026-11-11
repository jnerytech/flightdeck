import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blockingKeyCalls, SERVER_ALLOWED } from "../../lib/blocking-key-ratchet.ts";

describe("blocking-key-ratchet: a request handler never reads a project key through git", () => {
  test("counts the synchronous key reads of a source", () => {
    expect(blockingKeyCalls("const a = keys.keyFor(cwd);\nhub.projectKey(s.cwd)")).toBe(2);
    expect(blockingKeyCalls("await keys.resolve(cwd); opts.projectKeyOf(cwd)")).toBe(0);
    expect(blockingKeyCalls("")).toBe(0);
  });

  test("the server reads keys synchronously only in `listed`, whose callers warm the cache first", () => {
    // Issue #1288: the handlers left server.ts for apps/daemon/src/server, so both are read.
    const dir = resolve(import.meta.dir, "../../../apps/daemon/src/server");
    const files = [
      resolve(import.meta.dir, "../../../apps/daemon/src/server.ts"),
      ...readdirSync(dir, { recursive: true })
        .map(String)
        .filter((f) => f.endsWith(".ts"))
        .map((f) => resolve(dir, f)),
    ];
    const total = files.reduce((n, f) => n + blockingKeyCalls(readFileSync(f, "utf8")), 0);
    expect(total).toBe(SERVER_ALLOWED);
    // The one read is in `listed`; every handler that reaches it awaits `warmKeys` first.
    const sessions = readFileSync(resolve(dir, "handlers/session.ts"), "utf8");
    expect(blockingKeyCalls(sessions)).toBe(1);
    expect(sessions.match(/await server\.warmKeys\(/g)?.length).toBe(2);
  });
});
