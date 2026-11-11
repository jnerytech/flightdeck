import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PROJECTS, runAll, typecheckJobs, typecheckPlan } from "../lib/typecheck.ts";

const ROOT = resolve(import.meta.dir, "../..");

describe("typecheck-plan", () => {
  test("each project gets one incremental tsc run, its build info under node_modules/.cache", () => {
    expect(typecheckPlan(["packages/protocol", "apps/desktop"])).toEqual([
      [
        "tsc",
        "-p",
        "packages/protocol/tsconfig.json",
        "--incremental",
        "--tsBuildInfoFile",
        "node_modules/.cache/tsc/packages-protocol.tsbuildinfo",
      ],
      [
        "tsc",
        "-p",
        "apps/desktop/tsconfig.json",
        "--incremental",
        "--tsBuildInfoFile",
        "node_modules/.cache/tsc/apps-desktop.tsbuildinfo",
      ],
    ]);
  });

  test("the projects are every workspace with a typecheck script, plus scripts, protocol first", () => {
    const workspaces = ["packages/protocol", "apps/daemon", "apps/desktop"].filter((dir) => {
      const pkg = JSON.parse(readFileSync(join(ROOT, dir, "package.json"), "utf8"));
      return typeof pkg.scripts?.typecheck === "string";
    });
    expect(PROJECTS).toEqual([...workspaces, "scripts"]);
    for (const dir of PROJECTS) expect(existsSync(join(ROOT, dir, "tsconfig.json"))).toBe(true);
  });

  test("every run happens in order, one at a time, and the first failure is the result", async () => {
    const order: string[] = [];
    let running = 0;
    let most = 0;
    const logs: string[] = [];
    const code = await runAll(
      [
        ["tsc", "-p", "a"],
        ["tsc", "-p", "b"],
        ["tsc", "-p", "c"],
      ],
      async (command) => {
        running++;
        most = Math.max(most, running);
        // Yields: a runner that started them all at once would count two here.
        await Promise.resolve();
        running--;
        order.push(command[2] ?? "");
        return command[2] === "b" ? 2 : 0;
      },
      (line) => logs.push(line),
    );
    expect(order).toEqual(["a", "b", "c"]);
    expect(most).toBe(1);
    expect(code).toBe(2);
    expect(logs.slice(0, 3)).toEqual(["typecheck a", "typecheck b", "typecheck c"]);
  });

  test("with a limit of two, two runs overlap, every run finishes and the first failure in plan order is the result", async () => {
    let running = 0;
    let most = 0;
    const done: string[] = [];
    const code = await runAll(
      [
        ["tsc", "-p", "a"],
        ["tsc", "-p", "b"],
        ["tsc", "-p", "c"],
        ["tsc", "-p", "d"],
      ],
      async (command) => {
        running++;
        most = Math.max(most, running);
        await new Promise((resolve) => setTimeout(resolve, command[2] === "a" ? 5 : 1));
        running--;
        done.push(command[2] ?? "");
        return command[2] === "b" ? 2 : command[2] === "c" ? 3 : 0;
      },
      () => {},
      { limit: 2 },
    );
    expect(most).toBe(2);
    expect([...done].sort()).toEqual(["a", "b", "c", "d"]);
    expect(code).toBe(2);
  });

  test("the run ends with each project's time and the total, from the clock it is given", async () => {
    let clock = 0;
    const logs: string[] = [];
    await runAll(
      [
        ["tsc", "-p", "packages/protocol/tsconfig.json"],
        ["tsc", "-p", "apps/desktop/tsconfig.json"],
      ],
      async (command) => {
        clock += command[2]?.startsWith("apps") ? 4_200 : 600;
        return 0;
      },
      (line) => logs.push(line),
      { now: () => clock },
    );
    expect(logs.at(-1)).toBe("typecheck: packages/protocol 0.6s, apps/desktop 4.2s, total 4.8s");
  });
});

describe("a run that cannot start", () => {
  test("counts as a failure, says why, and the other projects still finish", async () => {
    const done: string[] = [];
    const logs: string[] = [];
    const code = await runAll(
      [
        ["tsc", "-p", "a"],
        ["tsc", "-p", "b"],
        ["tsc", "-p", "c"],
      ],
      async (command) => {
        if (command[2] === "a") throw new Error("spawn tsc ENOENT");
        done.push(command[2] ?? "");
        return 0;
      },
      (line) => logs.push(line),
      { limit: 2 },
    );
    expect(code).toBe(1);
    expect(done.sort()).toEqual(["b", "c"]);
    expect(logs).toContain("typecheck a: could not run: spawn tsc ENOENT");
    expect(logs.at(-1)).toContain("total");
  });
});

describe("no project is checked less", () => {
  test.each(PROJECTS)(
    "a type error in %s fails the run, in sequence and two at a time",
    async (project) => {
      for (const limit of [1, 2]) {
        const code = await runAll(
          typecheckPlan(),
          async (command) => (command[2] === `${project}/tsconfig.json` ? 2 : 0),
          () => {},
          { limit },
        );
        expect(code).toBe(2);
      }
    },
  );
});

describe("typecheckJobs", () => {
  const meminfo = (gb: number) => `MemTotal: 16000000 kB\nMemAvailable: ${gb * 1024 * 1024} kB\n`;

  test("two runs at once from 8 GB available, one below it or when the memory is unknown", () => {
    expect(typecheckJobs(meminfo(8), undefined)).toBe(2);
    expect(typecheckJobs(meminfo(12), undefined)).toBe(2);
    expect(typecheckJobs(meminfo(7), undefined)).toBe(1);
    expect(typecheckJobs(null, undefined)).toBe(1);
  });

  test("FLIGHTDECK_TYPECHECK_JOBS wins when it is a whole number of at least 1", () => {
    expect(typecheckJobs(meminfo(4), "3")).toBe(3);
    expect(typecheckJobs(meminfo(12), "1")).toBe(1);
    expect(typecheckJobs(meminfo(12), "0")).toBe(2);
    expect(typecheckJobs(meminfo(12), "many")).toBe(2);
  });
});
