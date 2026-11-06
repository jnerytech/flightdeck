import { describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join, normalize } from "node:path";
import type { PermissionUpdate } from "@flightdeck/protocol";
import { realPathOf } from "../src/permissions/path-kind.ts";
import { checkUpdates, ruleReadings } from "../src/permissions/permission-updates.ts";
import { RiskClassifier } from "../src/permissions/risk.ts";
import {
  type ClassifyCall,
  type PathKind,
  pathReadings,
  realPaths,
  ruleLevel,
} from "../src/permissions/rule-risk.ts";
import { tempDir } from "./helpers.ts";

const PROJECT = "/proj";
const HOME = "/home/me";
const risk = new RiskClassifier({ allowedRoots: [], home: HOME });
const classify: ClassifyCall = (tool, input) => risk.classify(tool, input, PROJECT).level;
const file: PathKind = () => "file";
const folder: PathKind = () => "dir";
/** A real path for one reading; every other reading has no link on the way. */
const linked =
  (reading: string, to: string | null) =>
  (asked: string): string | null | undefined =>
    asked === reading ? to : undefined;

describe("rule-realpath: a rule is rated on the real path behind a symlink too (issue #528)", () => {
  test("an exact file rule whose path is a link out of the project rates as what the link reaches", () => {
    expect(ruleLevel("Read", "notes.txt", classify, file)).toBe("low");
    expect(
      ruleLevel("Read", "notes.txt", classify, file, linked("notes.txt", "/elsewhere/notes.txt")),
    ).toBe("medium");
    expect(ruleLevel("Write", "notes.txt", classify, file)).toBe("medium");
    expect(
      ruleLevel("Write", "notes.txt", classify, file, linked("notes.txt", "/home/me/.bashrc")),
    ).toBe("high");
  });

  test("an exact rule whose path is a link to a credential rates high; a folder rule was refused already (#395)", () => {
    expect(
      ruleLevel("Read", "notes.txt", classify, file, linked("notes.txt", "/home/me/.ssh/id_rsa")),
    ).toBe("high");
    expect(ruleLevel("Read", "docs", classify, folder)).toBe("any");
  });

  test("a wildcard rule whose fixed folder is a link out of the project is not narrow", () => {
    expect(ruleLevel("Write", "src/app-*.ts", classify, file)).toBe("medium");
    expect(
      ruleLevel("Write", "src/app-*.ts", classify, file, linked("src/app-*.ts", "/etc/app-*.ts")),
    ).toBe("any");
  });

  test("a path whose real path could not be read is refused; one with no link on the way rates as before", () => {
    expect(ruleLevel("Read", "notes.txt", classify, file, linked("notes.txt", null))).toBe("any");
    expect(ruleLevel("Read", "notes.txt", classify, file, () => undefined)).toBe("low");
  });

  test("checkUpdates refuses a rule the real path makes broader than the request", () => {
    const update: PermissionUpdate = {
      type: "addRules",
      rules: [{ toolName: "Write", ruleContent: "notes.txt" }],
      behavior: "allow",
      destination: "localSettings",
    };
    const request = { toolName: "Write", suggestions: [], risk: "medium" as const, classify };
    expect(() => checkUpdates([update], { ...request, kind: file })).not.toThrow();
    let code = "";
    try {
      checkUpdates([update], {
        ...request,
        kind: file,
        real: linked("notes.txt", "/home/me/.bashrc"),
      });
    } catch (error) {
      code = (error as { reason?: string }).reason ?? "";
    }
    expect(code).toBe("perm_rule_too_broad");
  });

  test("the readings asked about are every reading of the path rules, wildcards too", () => {
    expect(pathReadings("Write", "/src/gen/*.ts")).toEqual(["src/gen/*.ts"]);
    expect(pathReadings("Read", "notes.txt")).toEqual(["notes.txt"]);
    expect(pathReadings("Bash", "npm test")).toEqual([]);
    expect(pathReadings("Read", "a/../b")).toEqual([]);
    const updates: PermissionUpdate[] = [
      {
        type: "addRules",
        rules: [
          { toolName: "Write", ruleContent: "src/*.ts" },
          { toolName: "Read", ruleContent: "~/notes" },
        ],
        behavior: "allow",
        destination: "localSettings",
      },
      { type: "setMode", mode: "acceptEdits", destination: "session" },
    ];
    expect(ruleReadings(updates)).toEqual(["src/*.ts", "~/notes"]);
  });
});

describe("rule-realpath: realPaths resolves each reading's fixed part once (issue #528)", () => {
  /** A disk where `links` maps a path to its real path; any other path is its own. */
  const disk = (links: Record<string, string | null>) => {
    const asked: string[] = [];
    const resolve = async (path: string) => {
      asked.push(path);
      return path in links ? (links[path] ?? null) : path;
    };
    return { asked, resolve };
  };

  test("an exact path through a link reads as its real path; one with no link on the way reads as nothing", async () => {
    const { resolve } = disk({ [join(PROJECT, "notes.txt")]: "/elsewhere/notes.txt" });
    const real = await realPaths(["notes.txt", "src/a.ts"], PROJECT, HOME, resolve);
    expect(real("notes.txt")).toBe(normalize("/elsewhere/notes.txt"));
    expect(real("src/a.ts")).toBeUndefined();
    expect(real("never-asked")).toBeNull();
  });

  test("a real path inside the real project or the real home is written under the project or the home", async () => {
    const { resolve } = disk({
      [PROJECT]: "/data/proj",
      [HOME]: "/real/me",
      [join(PROJECT, "src", "a.ts")]: "/data/proj/src/a.ts",
      [join(PROJECT, "lib")]: "/data/proj/vendor/lib",
      [join(HOME, "notes")]: "/real/me/.ssh",
    });
    const real = await realPaths(["src/a.ts", "lib", "~/notes"], PROJECT, HOME, resolve);
    expect(real("src/a.ts")).toBeUndefined();
    expect(real("lib")).toBe(join(PROJECT, "vendor", "lib"));
    expect(real("~/notes")).toBe(join(HOME, ".ssh"));
  });

  test("a wildcard reading resolves the folders before its first wildcard and keeps the rest", async () => {
    const { asked, resolve } = disk({ [join(PROJECT, "src", "gen")]: "/etc/gen" });
    const real = await realPaths(["src/gen/*.ts", "*.ts", "**/x.ts"], PROJECT, HOME, resolve);
    expect(real("src/gen/*.ts")).toBe(`${normalize("/etc/gen").replaceAll("\\", "/")}/*.ts`);
    expect(real("*.ts")).toBeUndefined();
    expect(real("**/x.ts")).toBeUndefined();
    expect(asked.filter((path) => path !== PROJECT && path !== HOME)).toEqual([
      join(PROJECT, "src", "gen"),
    ]);
  });

  test("a path it cannot resolve, a resolve that fails or hangs, and a path past the cap are null", async () => {
    const { resolve } = disk({ [join(PROJECT, "gone")]: null });
    const real = await realPaths(["gone"], PROJECT, HOME, resolve);
    expect(real("gone")).toBeNull();
    const failing = await realPaths(["a"], PROJECT, HOME, (path) =>
      path === join(PROJECT, "a") ? Promise.reject(new Error("EIO")) : Promise.resolve(path),
    );
    expect(failing("a")).toBeNull();
    const hanging = await realPaths(
      ["a"],
      PROJECT,
      HOME,
      (path) => (path === join(PROJECT, "a") ? new Promise(() => {}) : Promise.resolve(path)),
      { timeoutMs: 10 },
    );
    expect(hanging("a")).toBeNull();
    const many = Array.from({ length: 33 }, (_, i) => `f${i}.txt`);
    const capped = await realPaths(many, PROJECT, HOME, disk({}).resolve);
    expect(capped("f31.txt")).toBeUndefined();
    expect(capped("f32.txt")).toBeNull();
  });

  test("a network path is never resolved: it reaches another host, and its kind already refuses it", async () => {
    const { asked, resolve } = disk({});
    const real = await realPaths(["//host/share/x"], PROJECT, HOME, resolve);
    expect(real("//host/share/x")).toBeUndefined();
    expect(asked.filter((path) => path.includes("host"))).toEqual([]);
  });
});

describe("rule-realpath: realPathOf reads the disk (issue #528)", () => {
  test.skipIf(process.platform === "win32")(
    "a link, a plain file, a path not there yet, one under a linked folder, and a link to nowhere",
    async () => {
      const dir = tempDir();
      const outside = tempDir();
      writeFileSync(join(outside, "secret.txt"), "");
      writeFileSync(join(dir, "plain.txt"), "");
      symlinkSync(join(outside, "secret.txt"), join(dir, "link.txt"));
      mkdirSync(join(dir, "sub"));
      symlinkSync(outside, join(dir, "sub", "out"));
      symlinkSync(join(outside, "nowhere"), join(dir, "dangling"));
      expect(await realPathOf(join(dir, "link.txt"))).toBe(
        realpathSync.native(join(outside, "secret.txt")),
      );
      expect(await realPathOf(join(dir, "plain.txt"))).toBe(
        realpathSync.native(join(dir, "plain.txt")),
      );
      expect(await realPathOf(join(dir, "new.txt"))).toBe(
        join(realpathSync.native(dir), "new.txt"),
      );
      expect(await realPathOf(join(dir, "sub", "out", "new.txt"))).toBe(
        join(realpathSync.native(outside), "new.txt"),
      );
      expect(await realPathOf(join(dir, "dangling"))).toBeNull();
    },
  );

  test("a path it cannot look up is null, the reading that refuses", async () => {
    expect(await realPathOf("bad\0path")).toBeNull();
  });
});
