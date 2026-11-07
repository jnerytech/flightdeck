import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { viteCommands } from "../lib/demo-vite.ts";

const base = { bun: "/bin/bun", vite: "/d/vite.js", port: 4321, outDir: "/tmp/demo-dist" };

describe("demo-vite: the dev server for a person, a built bundle for CI (#444)", () => {
  test("without DEMO_BUILD the demo serves Vite's dev server on the port", () => {
    expect(viteCommands({ ...base, env: {} })).toEqual({
      build: null,
      serve: ["/bin/bun", "/d/vite.js", "--port", "4321", "--strictPort"],
    });
  });

  test("DEMO_BUILD=1 builds into the folder, then serves it with vite preview on the port", () => {
    expect(viteCommands({ ...base, env: { DEMO_BUILD: "1" } })).toEqual({
      build: ["/bin/bun", "/d/vite.js", "build", "--outDir", "/tmp/demo-dist", "--emptyOutDir"],
      serve: [
        "/bin/bun",
        "/d/vite.js",
        "preview",
        "--outDir",
        "/tmp/demo-dist",
        "--port",
        "4321",
        "--strictPort",
      ],
    });
  });

  test("any other DEMO_BUILD value keeps the dev server", () => {
    for (const value of ["", "0", "true"]) {
      expect(viteCommands({ ...base, env: { DEMO_BUILD: value } }).build).toBeNull();
    }
  });

  test("CI's prints and e2e jobs serve the built bundle", () => {
    const root = resolve(import.meta.dir, "../..");
    const ci = Bun.YAML.parse(readFileSync(join(root, ".github/workflows/ci.yml"), "utf8")) as {
      jobs: Record<string, { steps: Array<{ run?: string; env?: Record<string, string> }> }>;
    };
    for (const [job, command] of [
      ["screenshots-prints", "bun run demo:shots"],
      ["screenshots-e2e", "bun run e2e"],
    ] as const) {
      const step = ci.jobs[job]?.steps.find((s) => s.run?.startsWith(command));
      expect(`${job}: ${step?.env?.DEMO_BUILD}`).toBe(`${job}: 1`);
    }
  });
});

describe("demo-vite: the web entry reaches the build too (#444)", () => {
  test("the entry swap runs before Vite reads index.html's scripts, so vite build bundles main.web.tsx", async () => {
    const config = (await import("../../apps/desktop/vite.config.ts")).default as {
      plugins: Array<{ name?: string; transformIndexHtml?: unknown }>;
    };
    const entry = config.plugins.find((p) => p?.name === "flightdeck-entry")?.transformIndexHtml as
      | { order?: string }
      | undefined;
    expect(entry?.order).toBe("pre");
  });
});
