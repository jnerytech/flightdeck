import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { impureCalls, isDomainFile } from "../../lib/ratchets/domain-purity.ts";

// repo-wide (#1108): reads every tracked source file, so CI's quick job runs it on every PR.

const ROOT = resolve(import.meta.dir, "../../..");

describe("domain-purity (#1601)", () => {
  test("TypeScript under a domain/ folder of a package's src is scanned; the rest is not", () => {
    expect(isDomainFile("apps/daemon/src/board/domain/rules.ts")).toBe(true);
    expect(isDomainFile("apps/desktop/src/features/hosts/domain/health.tsx")).toBe(true);
    expect(isDomainFile("packages/protocol/src/domain/card.ts")).toBe(true);
    expect(isDomainFile("apps/daemon/src/board/adapters/store.ts")).toBe(false);
    expect(isDomainFile("apps/daemon/src/board/board.ts")).toBe(false);
    expect(isDomainFile("apps/daemon/test/board/domain/rules.test.ts")).toBe(false);
    expect(isDomainFile("apps/daemon/src/board/domain/types.d.ts")).toBe(false);
  });

  test("a call to Bun.spawn, Bun.file, Bun.write, Date.now or new Date() in a domain/ file is named with its line", () => {
    expect(
      impureCalls([
        {
          path: "apps/daemon/src/board/domain/rules.ts",
          text: [
            "const p = Bun.spawn(['git']);",
            "const f = Bun.file(path);",
            "await Bun.write(path, text);",
            "const t = Date.now();",
            "const d = new Date();",
            "const q = Bun.spawnSync(['git']);",
            "await Bun.$`git status`;",
            "const clock = Date.now;",
            "const e = new Date;",
            "const m = performance.now();",
            "const r = await fetch(url);",
            "setTimeout(tick, 10);",
            "const g = globalThis.fetch(url) + window.setTimeout(tick) + fetch (url);",
            "Bun.serve({ fetch }); await Bun.connect(opts); const h = process.hrtime.bigint();",
          ].join("\n"),
        },
      ]),
    ).toEqual([
      "apps/daemon/src/board/domain/rules.ts:1 Bun.spawn(",
      "apps/daemon/src/board/domain/rules.ts:2 Bun.file(",
      "apps/daemon/src/board/domain/rules.ts:3 Bun.write(",
      "apps/daemon/src/board/domain/rules.ts:4 Date.now(",
      "apps/daemon/src/board/domain/rules.ts:5 new Date()",
      "apps/daemon/src/board/domain/rules.ts:6 Bun.spawnSync(",
      "apps/daemon/src/board/domain/rules.ts:7 Bun.$",
      "apps/daemon/src/board/domain/rules.ts:8 Date.now",
      "apps/daemon/src/board/domain/rules.ts:9 new Date",
      "apps/daemon/src/board/domain/rules.ts:10 performance.now",
      "apps/daemon/src/board/domain/rules.ts:11 fetch(",
      "apps/daemon/src/board/domain/rules.ts:12 setTimeout(",
      "apps/daemon/src/board/domain/rules.ts:13 globalThis.fetch(",
      "apps/daemon/src/board/domain/rules.ts:13 window.setTimeout(",
      "apps/daemon/src/board/domain/rules.ts:13 fetch (",
      "apps/daemon/src/board/domain/rules.ts:14 Bun.serve(",
      "apps/daemon/src/board/domain/rules.ts:14 Bun.connect(",
      "apps/daemon/src/board/domain/rules.ts:14 process.hrtime",
    ]);
  });

  test("an import of a package that does I/O is named: dependency-cruiser drops node_modules edges, so the text is read", () => {
    expect(
      impureCalls([
        {
          path: "apps/desktop/src/features/hosts/domain/health.ts",
          text: [
            'import { WebSocket } from "ws";',
            'import { invoke } from "@tauri-apps/api/core";',
            'import { $ } from "bun";',
            'import { dlopen } from "bun:ffi";',
            'const lazy = await import("@tauri-apps/plugin-shell");',
            'import { WebSocketServer } from "ws/lib/websocket-server.js";',
            'import type { Database } from "bun:sqlite";',
            'import type, { spawn } from "bun";',
            'export type { Socket } from "ws";',
            'import { cmp } from "./compare.ts";',
            'const spaced = await import ("ws");',
          ].join("\n"),
        },
      ]),
    ).toEqual([
      'apps/desktop/src/features/hosts/domain/health.ts:1 "ws"',
      'apps/desktop/src/features/hosts/domain/health.ts:2 "@tauri-apps/api/core"',
      'apps/desktop/src/features/hosts/domain/health.ts:3 "bun"',
      'apps/desktop/src/features/hosts/domain/health.ts:4 "bun:ffi"',
      'apps/desktop/src/features/hosts/domain/health.ts:5 "@tauri-apps/plugin-shell"',
      'apps/desktop/src/features/hosts/domain/health.ts:6 "ws/lib/websocket-server.js"',
      'apps/desktop/src/features/hosts/domain/health.ts:8 "bun"',
      'apps/desktop/src/features/hosts/domain/health.ts:11 "ws"',
    ]);
  });

  test("comments, a date built from a value, files outside domain/ and a clock passed in are not calls", () => {
    expect(
      impureCalls([
        {
          path: "apps/daemon/src/board/domain/rules.ts",
          text: [
            "// Date.now() comes in through the port",
            " * Bun.spawn( is the adapter's job",
            "const d = new Date(ms);",
            "const span = new DateRange(a, b);",
            "const s = card.Date.now() + run.fetch(x) + this.setTimeout(y);",
            "export const age = (now: () => number, at: number) => now() - at;",
          ].join("\n"),
        },
        {
          path: "apps/daemon/src/board/adapters/clock.ts",
          text: "export const now = () => Date.now();\n",
        },
      ]),
    ).toEqual([]);
  });

  test("no tracked domain/ file calls an I/O or clock global", () => {
    const listed = spawnSync("git", ["ls-files", "apps", "packages"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(listed.status).toBe(0);
    const paths = listed.stdout.split("\n").filter(isDomainFile);
    const files = paths.map((path) => ({ path, text: readFileSync(join(ROOT, path), "utf8") }));
    expect(impureCalls(files)).toEqual([]);
  });
});
