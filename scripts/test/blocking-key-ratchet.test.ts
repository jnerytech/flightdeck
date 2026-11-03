import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blockingKeyCalls, SERVER_ALLOWED } from "../lib/blocking-key-ratchet.ts";

describe("blocking-key-ratchet: a request handler never reads a project key through git", () => {
  test("counts the synchronous key reads of a source", () => {
    expect(blockingKeyCalls("const a = keys.keyFor(cwd);\nhub.projectKey(s.cwd)")).toBe(2);
    expect(blockingKeyCalls("await keys.resolve(cwd); opts.projectKeyOf(cwd)")).toBe(0);
    expect(blockingKeyCalls("")).toBe(0);
  });

  test("server.ts reads keys synchronously only in `listed`, whose callers warm the cache first", () => {
    const server = readFileSync(
      resolve(import.meta.dir, "../../apps/daemon/src/server.ts"),
      "utf8",
    );
    expect(blockingKeyCalls(server)).toBe(SERVER_ALLOWED);
    // The one read is in `listed`; every dispatch that reaches it awaits `warmKeys` first.
    expect(server).toContain("await warmKeys(");
  });
});
