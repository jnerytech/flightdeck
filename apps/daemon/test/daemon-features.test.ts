import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DAEMON_FEATURES } from "@flightdeck/protocol";
import { GATES } from "../src/server/gates.ts";

// #747: this check reads the sources and starts no server, so it stays in the unit tier, which a
// worker's `test:related -- --fast --tier unit,component` runs. Inside recusas-recurso.test.ts
// (integration, it starts a daemon) it ran only in CI, and 5 branches pushed a feature they used
// before listing it.
describe("daemon features: the list in the protocol matches the server", () => {
  test("the server uses only listed features, and every listed feature is used", () => {
    // Issue #248: the names live in server.ts, in its handler modules and in the gate table.
    // Repo-relative, so `test:related` picks this file when one of them changes (it matches quoted paths).
    const root = resolve(import.meta.dir, "../../..");
    const dir = resolve(root, "apps/daemon/src/server");
    const files = [
      resolve(root, "apps/daemon/src/server.ts"),
      ...readdirSync(dir, { recursive: true })
        .map(String)
        .filter((f) => f.endsWith(".ts"))
        .map((f) => resolve(dir, f)),
    ];
    const source = files.map((f) => readFileSync(f, "utf8")).join("\n");
    const used = new Set([
      ...[...source.matchAll(/featureOff\("(\w+)"\)/g)].map((m) => m[1]),
      ...Object.values(GATES).filter((feature) => /^\w+$/.test(feature)),
    ]);
    expect(used.size).toBeGreaterThan(30);
    expect([...used].sort()).toEqual([...(DAEMON_FEATURES as readonly string[])].sort());
  });
});
