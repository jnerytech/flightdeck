import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { detectStack } from "../src/harness/stack.ts";
import { startServer } from "../src/server.ts";
import { newManager, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

/**
 * Issue #75, slice S2b: a project's stack and its commands, learned from its manifest files. Read,
 * never run; a command is a fixed form, never a script's text.
 */
const TOKEN = "harness-stack-token-0123456789";
const onWindows = process.platform === "win32";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

function repo(files: Record<string, string>) {
  const root = tempDir("fd-stack-");
  for (const [name, text] of Object.entries(files)) {
    const file = join(root, name);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, text);
  }
  return root;
}

const none = { test: null, lint: null, format: null, build: null };

describe("harness-stack: what a project is built with, read from its manifests (#75)", () => {
  test("a node project's scripts become its runner's commands, and a script's text never leaves", async () => {
    const scripts = { test: "bun test --secret-flag", lint: "biome lint", build: "tsc" };
    const withBun = repo({
      "package.json": JSON.stringify({ scripts: { ...scripts, format: "biome format" } }),
      "bun.lock": "",
    });
    const withNpm = repo({ "package.json": JSON.stringify({ scripts }) });
    const found = await detectStack(withBun);
    expect([found, await detectStack(withNpm), JSON.stringify(found).includes("secret")]).toEqual([
      {
        stacks: ["node"],
        commands: {
          test: "bun run test",
          lint: "bun run lint",
          format: "bun run format",
          build: "bun run build",
        },
      },
      {
        stacks: ["node"],
        commands: {
          test: "npm run test",
          lint: "npm run lint",
          format: null,
          build: "npm run build",
        },
      },
      false,
    ]);
  });

  test("python, go, rust and dotnet projects get their tools' fixed commands", async () => {
    const at = (files: Record<string, string>) => detectStack(repo(files));
    expect([
      await at({ "pyproject.toml": "[tool.ruff]\n[tool.pytest.ini_options]\n" }),
      await at({ "go.mod": "module example.com/x\n" }),
      await at({ "Cargo.toml": '[package]\nname = "x"\n' }),
      await at({ "App.csproj": "<Project />\n" }),
    ]).toEqual([
      {
        stacks: ["python"],
        commands: { test: "pytest", lint: "ruff check .", format: "ruff format .", build: null },
      },
      {
        stacks: ["go"],
        commands: {
          test: "go test ./...",
          lint: "go vet ./...",
          format: "gofmt -w .",
          build: "go build ./...",
        },
      },
      {
        stacks: ["rust"],
        commands: {
          test: "cargo test",
          lint: "cargo clippy",
          format: "cargo fmt",
          build: "cargo build",
        },
      },
      {
        stacks: ["dotnet"],
        commands: {
          test: "dotnet test",
          lint: null,
          format: "dotnet format",
          build: "dotnet build",
        },
      },
    ]);
  });

  test("a project of several stacks lists each; a command comes from the first that has one", async () => {
    const root = repo({
      "package.json": JSON.stringify({ scripts: { test: "x" } }),
      "go.mod": "module x\n",
    });
    expect(await detectStack(root)).toEqual({
      stacks: ["node", "go"],
      commands: {
        test: "npm run test",
        lint: "go vet ./...",
        format: "gofmt -w .",
        build: "go build ./...",
      },
    });
  });

  test("nothing is learned from a manifest that leaves the project, is too big, is a folder or is not JSON", async () => {
    const outside = repo({
      "package.json": JSON.stringify({ scripts: { test: "x" } }),
      "go.mod": "module x\n",
    });
    const root = repo({
      "pyproject.toml": `${"#".repeat(300 * 1024)}\n[tool.ruff]\n`,
    });
    mkdirSync(join(root, "Cargo.toml"));
    writeFileSync(join(root, "package.json"), "{ not json");
    if (!onWindows) symlinkSync(join(outside, "go.mod"), join(root, "go.mod"));
    expect(await detectStack(root)).toEqual({ stacks: [], commands: none });
  });

  test("a folder that is gone is a project with nothing, not an error", async () => {
    const gone = join(tempDir("fd-stack-"), "gone");
    expect(await detectStack(gone).catch(() => "threw")).toEqual({ stacks: [], commands: none });
  });

  test("the server answers project.harness.stack inside the allowed roots only, and a host without it says so", async () => {
    const root = repo({ "go.mod": "module x\n" });
    const { manager } = newManager();
    const base = {
      manager,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
    };
    const server = startServer({ ...base, harnessStack: detectStack });
    const off = startServer(base);
    const client = new FrameClient(server.url);
    const bare = new FrameClient(off.url);
    cleanups.push(async () => {
      client.close();
      bare.close();
      await server.stop();
      await off.stop();
    });
    for (const c of [client, bare]) await c.request("hello", { token: TOKEN, client: "test" });
    // A successful ack carries `data`; a refused one, `error` with its reason and params.
    const data = (ack: Record<string, unknown>) =>
      (ack.data as { stacks?: unknown } | undefined)?.stacks ?? null;
    const error = (ack: Record<string, unknown>) =>
      (ack.error as { reason?: string; params?: unknown } | undefined) ?? null;
    expect([
      data(await client.request("project.harness.stack", { path: root })),
      error(await client.request("project.harness.stack", { path: tempDir("fd-elsewhere-") }))
        ?.reason,
      error(await bare.request("project.harness.stack", { path: root }))?.params,
    ]).toEqual([["go"], "cwd_outside_roots", { feature: "harnessStack" }]);
  });
});
