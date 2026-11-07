import { describe, expect, test } from "bun:test";
import { join, normalize } from "node:path";
import type { PermissionUpdate } from "@flightdeck/protocol";
import ignore from "ignore";
import { checkUpdates, rulePaths } from "../src/permissions/permission-updates.ts";
import { RANK, RiskClassifier } from "../src/permissions/risk.ts";
import {
  type ClassifyCall,
  type PathKind,
  pathKinds,
  ruleLevel,
  writeTarget,
} from "../src/permissions/rule-risk.ts";

/**
 * The contract between `ruleLevel` and the matcher Claude Code runs for a Read or Edit rule
 * (issue #395). The CLI's path rules follow the gitignore spec, and its binary bundles the
 * `ignore` package (its error texts are in it), so `ignore` stands for the CLI's matching here.
 * What this test does not prove: how the CLI turns `//abs`, `~/`, `/` and a bare path into a root
 * and a relative path. It uses absolute rules (`//proj/...`) matched from `/`, the one form whose
 * root is plain (docs/decisions/2026-11-06-rule-contract.md). What is on disk is the probes: a
 * probe is a file, and every folder above one is a folder.
 */

const PROJECT = "/proj";
const HOME = "/home/me";
const risk = new RiskClassifier({ allowedRoots: [], home: HOME });
const classify: ClassifyCall = (tool, input) => risk.classify(tool, input, PROJECT).level;

/** Paths a rule could cover: the project's code, its control files, and credentials in and out. */
const PROBES = [
  "/proj/src/a.ts",
  "/proj/src/b/c.ts",
  "/proj/src/.env",
  "/proj/src/b/.env",
  "/proj/src/.ssh/id_rsa",
  "/proj/src/ID_RSA",
  "/proj/src/x.pem",
  "/proj/src/credentials",
  "/proj/SRC/.env",
  "/proj/app-1.ts",
  "/proj/README.md",
  "/proj/.env",
  "/proj/.env.local",
  "/proj/.git/config",
  "/proj/.claude/settings.json",
  "/proj/package.json",
  "/proj/conf.d/.env",
  "/home/me/.ssh/id_rsa",
  "/home/me/.aws/credentials",
  "/etc/passwd",
];

/** Rules a person could save from a request: a folder, a file, and wildcards in the project. */
const RULES = [
  "//proj/src",
  "//proj/src/",
  "//proj/src/a.ts",
  "//proj/src/*.ts",
  "//proj/src/**",
  "//proj/src/**/*.ts",
  "//proj/app-*.ts",
  "//proj/*.md",
  "//proj/**/*.ts",
  "//proj/conf.d",
  "//proj/README.md",
];

/** What the probes make of a path a rule names: a file, a folder above one, or nothing. */
const onDisk: PathKind = (path) => {
  const at = path.startsWith("/") ? path : `/${path}`;
  if (PROBES.includes(at)) return "file";
  return PROBES.some((probe) => probe.startsWith(`${at.replace(/\/+$/, "")}/`)) ? "dir" : "missing";
};

/** Whether the CLI's matcher, read as `ignore`, lets `rule` cover `path`. */
function covers(rule: string, path: string, ignorecase: boolean): boolean {
  const pattern = rule.slice(1);
  return ignore({ ignorecase }).add(pattern).ignores(path.slice(1));
}

/** Each call the CLI would let a saved rule through that the daemon rates above the rule's level. */
function breaches(tool: string, ignorecase: boolean): string[] {
  const found: string[] = [];
  for (const rule of RULES) {
    const level = ruleLevel(tool, rule, classify, onDisk);
    if (level === "any") continue;
    for (const path of PROBES.filter((probe) => covers(rule, probe, ignorecase))) {
      const call = classify(tool, { file_path: path });
      if (RANK[call] > RANK[level])
        found.push(`${tool}(${rule}) covers ${path}: ${call} > ${level}`);
    }
  }
  return found;
}

describe("rule-risk: a saved path rule covers no call riskier than its level, read as the CLI matches it (issue #395)", () => {
  for (const tool of ["Read", "Edit", "Write"]) {
    for (const ignorecase of [true, false]) {
      test(`${tool}, ${ignorecase ? "case-insensitive (Windows, the matcher's default)" : "case-sensitive"}`, () => {
        expect(breaches(tool, ignorecase)).toEqual([]);
      });
    }
  }

  test("the stand-in matcher reads a folder, a wildcard and a dotfile the gitignore way", () => {
    expect(covers("//proj/src", "/proj/src/b/c.ts", false)).toBe(true);
    expect(covers("//proj/src/*.ts", "/proj/src/b/c.ts", false)).toBe(false);
    expect(covers("//proj/src/**", "/proj/src/.env", false)).toBe(true);
    expect(covers("//proj/src", "/proj/SRC/.env", true)).toBe(true);
    expect(covers("//proj/src", "/proj/SRC/.env", false)).toBe(false);
  });
});

describe("rule-risk: a rule that names a folder covers what is inside it (issue #395)", () => {
  const missing: PathKind = () => "missing";
  const folder: PathKind = () => "dir";
  const file: PathKind = () => "file";

  test("a folder on disk, a path not there yet, or a path that ends with a slash, is refused: a credential can be inside, now or once it is made", () => {
    expect(ruleLevel("Write", "//proj/new", classify, missing)).toBe("any");
    expect(ruleLevel("Read", "//proj/new.ts", classify, missing)).toBe("any");
    expect(ruleLevel("Read", "//proj/src", classify, folder)).toBe("any");
    expect(ruleLevel("Edit", "src", classify, folder)).toBe("any");
    expect(ruleLevel("Grep", "src", classify, folder)).toBe("any");
    expect(ruleLevel("Read", "//proj/src/", classify, missing)).toBe("any");
  });

  test("a folder named with slashes at its end is probed below the folder, with no empty segment", () => {
    const probed: string[] = [];
    const record: ClassifyCall = (_tool, input) => {
      probed.push(String(input.file_path));
      return "low";
    };
    ruleLevel("Read", "//proj/src///", record, folder);
    // The rule's own path is probed as written; what is probed below it has one slash only.
    expect(probed.some((path) => path.startsWith("/proj/src/") && !path.includes("//"))).toBe(true);
  });

  test("only a file on disk keeps the level of the path itself", () => {
    expect(ruleLevel("Read", "//proj/src/a.ts", classify, file)).toBe("low");
    expect(ruleLevel("Read", "//proj/src/a.ts", classify, onDisk)).toBe("low");
    expect(ruleLevel("Read", "//proj/README.md", classify, onDisk)).toBe("low");
  });

  test("pathKinds looks up at most 32 paths, never a network path, and a look-up that hangs counts as a folder", async () => {
    let asked = 0;
    const many = Array.from({ length: 33 }, (_, i) => `f${i}.ts`);
    const counted = await pathKinds(many, "/proj", "/home/me", async () => {
      asked++;
      return "file";
    });
    expect(asked).toBe(32);
    expect([counted("f0.ts"), counted("f32.ts")]).toEqual(["file", "dir"]);
    const unc = await pathKinds(
      ["//server/share/x", "\\\\server\\share\\x"],
      "/proj",
      "/home/me",
      async () => "file",
    );
    expect([unc("//server/share/x"), unc("\\\\server\\share\\x")]).toEqual(["dir", "dir"]);
    const hung = await pathKinds(["a.ts"], "/proj", "/home/me", () => new Promise(() => {}), {
      timeoutMs: 5,
    });
    expect(hung("a.ts")).toBe("dir");
    const broken = await pathKinds(["a.ts"], "/proj", "/home/me", () =>
      Promise.reject(new Error("EIO")),
    );
    expect(broken("a.ts")).toBe("dir");
  });

  test("pathKinds looks each path up from the request's folder and the home, and a path it did not look up counts as a folder", async () => {
    const asked: string[] = [];
    const stat = async (path: string) => {
      asked.push(path);
      return path === join("/proj", "src")
        ? ("dir" as const)
        : path === normalize("/etc/hosts")
          ? ("file" as const)
          : ("missing" as const);
    };
    const kind = await pathKinds(
      ["src", "/etc/hosts", "~/notes", "src"],
      "/proj",
      "/home/me",
      stat,
    );
    // The paths are joined the platform's way: backslashes on Windows.
    expect([...asked].sort()).toEqual(
      [normalize("/etc/hosts"), join("/home/me", "notes"), join("/proj", "src")].sort(),
    );
    expect([kind("src"), kind("/etc/hosts"), kind("~/notes"), kind("never-asked")]).toEqual([
      "dir",
      "file",
      "missing",
      "dir",
    ]);
  });
});

describe("rule-risk: the exact paths the server looks up, and the check without them (issue #395)", () => {
  const add = (toolName: string, ruleContent?: string): PermissionUpdate => ({
    type: "addRules",
    rules: [{ toolName, ...(ruleContent === undefined ? {} : { ruleContent }) }],
    behavior: "allow",
    destination: "localSettings",
  });

  test("rulePaths lists each path rule's exact paths: no wildcard, no shell rule, no other update", () => {
    const updates: PermissionUpdate[] = [
      add("Read", "src/a.ts"),
      add("Grep", "src/*.ts"),
      add("Bash", "ls"),
      add("Write"),
      { type: "setMode", mode: "acceptEdits", destination: "session" },
    ];
    expect(rulePaths(updates)).toEqual(["src/a.ts"]);
  });

  test("the file the request itself writes counts as a file before it exists; any other missing path does not", async () => {
    const kind = await pathKinds(
      ["new.ts", "other.ts"],
      "/proj",
      "/home/me",
      async () => "missing",
      {
        target: "new.ts",
      },
    );
    expect([kind("new.ts"), kind("other.ts")]).toEqual(["file", "missing"]);
    const absolute = await pathKinds(["/proj/new.ts"], "/proj", "/home/me", async () => "missing", {
      target: "/proj/new.ts",
    });
    expect(absolute("/proj/new.ts")).toBe("file");
    // A tool writes `~/x` under its folder, not the home: a rule for the home's ~/x stays a folder.
    const tilde = await pathKinds(["~/x"], "/proj", "/home/me", async () => "missing", {
      target: "~/x",
    });
    expect(tilde("~/x")).toBe("missing");
  });

  test("writeTarget names the file a write tool is about to write, and nothing for a read or a shell", () => {
    expect(writeTarget("Write", { file_path: "new.ts", content: "x" })).toBe("new.ts");
    expect(writeTarget("NotebookEdit", { notebook_path: "n.ipynb" })).toBe("n.ipynb");
    expect(writeTarget("Read", { file_path: "a.ts" })).toBeUndefined();
    expect(writeTarget("Bash", { command: "touch x" })).toBeUndefined();
    expect(writeTarget("Write", { file_path: 3 })).toBeUndefined();
  });

  test("checkUpdates reads a path it was not told about as a folder, so the rule is refused", () => {
    const request = { toolName: "Read", suggestions: [], risk: "low" as const, classify };
    expect(() => checkUpdates([add("Read", "/proj/src/a.ts")], request)).toThrow();
    expect(() =>
      checkUpdates([add("Read", "/proj/src/a.ts")], { ...request, kind: () => "file" }),
    ).not.toThrow();
  });
});
