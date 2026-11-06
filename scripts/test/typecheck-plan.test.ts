import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PROJECTS, runAll, typecheckPlan } from "../lib/typecheck.ts";

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
    expect(logs).toEqual(["typecheck a", "typecheck b", "typecheck c"]);
  });
});
