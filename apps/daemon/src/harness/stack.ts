/**
 * Issue #75, slice S2b: the project's stack and the commands it is tested, linted, formatted and
 * built with, learned from its manifest files (package.json, pyproject.toml, go.mod, Cargo.toml, a
 * .csproj or .sln). Nothing is run, and no script body leaves the host: a command is a fixed form
 * (`bun run test`, `cargo test`), never text from a file. Each file is read only when it is a plain
 * file inside the project, of a sane size.
 */
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import type { HarnessStack } from "@flightdeck/protocol";
import { isInside } from "../paths.ts";

type Stack = HarnessStack["stacks"][number];
type Commands = HarnessStack["commands"];

const MAX_FILE = 256 * 1024;

/** A manifest's text: only a plain file inside the project, of a sane size; null otherwise. */
async function readInside(root: string, name: string): Promise<string | null> {
  try {
    const real = await realpath(join(root, name));
    if (!isInside(root, real)) return null;
    const info = await stat(real);
    if (!info.isFile() || info.size > MAX_FILE) return null;
    return await readFile(real, "utf8");
  } catch {
    return null;
  }
}

/** The runner a node project's lockfile names. */
async function runner(root: string): Promise<string> {
  for (const [lock, name] of [
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
  ] as const) {
    if ((await readInside(root, lock)) !== null) return name;
  }
  return "npm";
}

/** The commands of a node project: a fixed `<runner> run <name>` for each script it has. */
async function node(root: string): Promise<Partial<Commands> | null> {
  const text = await readInside(root, "package.json");
  if (text === null) return null;
  let scripts: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(text) as { scripts?: unknown };
    if (parsed.scripts && typeof parsed.scripts === "object") {
      scripts = parsed.scripts as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  const run = await runner(root);
  const named = (...names: string[]) => {
    const found = names.find((name) => typeof scripts[name] === "string");
    return found ? `${run} run ${found}` : null;
  };
  return {
    test: named("test"),
    lint: named("lint"),
    format: named("format", "fmt"),
    build: named("build"),
  };
}

async function python(root: string): Promise<Partial<Commands> | null> {
  const text = await readInside(root, "pyproject.toml");
  if (text === null) return null;
  const ruff = /\bruff\b/.test(text);
  return {
    test: /\bpytest\b/.test(text) ? "pytest" : null,
    lint: ruff ? "ruff check ." : null,
    format: ruff ? "ruff format ." : /\bblack\b/.test(text) ? "black ." : null,
  };
}

const fixed =
  (file: string, commands: Partial<Commands>) =>
  async (root: string): Promise<Partial<Commands> | null> =>
    (await readInside(root, file)) === null ? null : commands;

/** A .csproj or .sln at the project's top. */
async function dotnet(root: string): Promise<Partial<Commands> | null> {
  const entries = await readdir(root).catch(() => [] as string[]);
  const project = entries.find((name) => name.endsWith(".csproj") || name.endsWith(".sln"));
  if (!project || (await readInside(root, project)) === null) return null;
  return { test: "dotnet test", format: "dotnet format", build: "dotnet build" };
}

const DETECTORS: ReadonlyArray<[Stack, (root: string) => Promise<Partial<Commands> | null>]> = [
  ["node", node],
  ["python", python],
  [
    "go",
    fixed("go.mod", {
      test: "go test ./...",
      lint: "go vet ./...",
      format: "gofmt -w .",
      build: "go build ./...",
    }),
  ],
  [
    "rust",
    fixed("Cargo.toml", {
      test: "cargo test",
      lint: "cargo clippy",
      format: "cargo fmt",
      build: "cargo build",
    }),
  ],
  ["dotnet", dotnet],
];

/** Every stack the project shows; each command comes from the first stack that has one. */
export async function detectStack(path: string): Promise<HarnessStack> {
  const root = await realpath(path).catch(() => path);
  const stacks: Stack[] = [];
  const commands: Commands = { test: null, lint: null, format: null, build: null };
  for (const [stack, detect] of DETECTORS) {
    const found = await detect(root);
    if (!found) continue;
    stacks.push(stack);
    for (const key of ["test", "lint", "format", "build"] as const) {
      commands[key] ??= found[key] ?? null;
    }
  }
  return { stacks, commands };
}
