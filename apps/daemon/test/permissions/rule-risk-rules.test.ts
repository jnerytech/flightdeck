import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { RiskClassifier } from "../../src/permissions/domain/risk.ts";
import {
  type ClassifyCall,
  type PathKind,
  ruleLevel,
  writeTarget,
} from "../../src/permissions/domain/rule-risk.ts";
import { pathKinds, realPaths } from "../../src/permissions/rule-risk.ts";

/**
 * What a saved permission rule may cover, by the kind of rule: a shell rule, a network rule, a rule
 * for a tool this check does not know, and the facts a path rule asks about (issue #1607, the
 * mutants of the rule classifier that no other test killed). `ruleLevel` is the public entry; the
 * classifier behind it is a recorder that says which call it was asked to rate.
 */

const PROJECT = "/proj";
const HOME = "/home/me";
const real = new RiskClassifier({ allowedRoots: [], home: HOME });
const classify: ClassifyCall = (tool, input) => real.classify(tool, input, PROJECT).level;
const file: PathKind = () => "file";
const folder: PathKind = () => "dir";

/** A classifier that rates every call `medium` and records what it was asked. */
function recorder() {
  const calls: Array<{ tool: string; input: Record<string, unknown> }> = [];
  const classifyCall: ClassifyCall = (tool, input) => {
    calls.push({ tool, input });
    return "medium";
  };
  return { calls, classifyCall };
}

describe("rule-risk: a shell rule is exact, or open only for the repository status and the project's scripts (issue #384)", () => {
  test("a rule for the whole shell tool has no level: any command would pass", () => {
    expect(ruleLevel("Bash", undefined, classify, file)).toBe("any");
  });

  test("a rule with no wildcard is rated as the exact command it names, on the tool it is for", () => {
    const { calls, classifyCall } = recorder();
    expect(ruleLevel("Bash", "ls -la", classifyCall, file)).toBe("medium");
    expect(calls).toEqual([{ tool: "Bash", input: { command: "ls -la" } }]);
    expect(ruleLevel("Bash", "rm -rf /", classify, file)).toBe(
      classify("Bash", { command: "rm -rf /" }),
    );
    expect(ruleLevel("Bash", "rm -rf /", classify, file)).not.toBe("low");
  });

  test("a prefix with `:*` or ` *` is rated as its command alone, spaces around it trimmed", () => {
    for (const rule of ["git status:*", "git status *", "git status  *", "git status :*"]) {
      const { calls, classifyCall } = recorder();
      expect(ruleLevel("Bash", rule, classifyCall, file)).toBe("medium");
      expect(calls).toEqual([{ tool: "Bash", input: { command: "git status" } }]);
    }
  });

  test("every open form is the status of the repository or one of the project's scripts, rated as its command", () => {
    const forms: Array<[string, string]> = [
      ["git status:*", "git status"],
      ["npm test:*", "npm test"],
      ["pnpm test:*", "pnpm test"],
      ["yarn test:*", "yarn test"],
      ["bun test:*", "bun test"],
      ["npm run build:*", "npm run build"],
      ["bun run test:unit:*", "bun run test:unit"],
      ["yarn run b *", "yarn run b"],
      ["pnpm run lint-fix *", "pnpm run lint-fix"],
    ];
    for (const [rule, command] of forms) {
      const { calls, classifyCall } = recorder();
      expect(ruleLevel("Bash", rule, classifyCall, file), rule).toBe("medium");
      expect(calls, rule).toEqual([{ tool: "Bash", input: { command } }]);
    }
  });

  test("a wildcard in any other place, or after another command, is refused", () => {
    for (const rule of [
      "git status*",
      "git status:* extra",
      "git status *:*",
      "git status -s:*",
      "git statuses:*",
      "xgit status:*",
      "git log:*",
      "git diff *",
      "ls *",
      "env *",
      "npm testing:*",
      "xnpm test:*",
      "xnpm run build:*",
      "npm test -- --watch:*",
      "npm run build all:*",
      "npm run -x:*",
      "npm run :x:*",
      "npm run:*",
      "git status; rm x:*",
      "git status && rm x *",
      "git status $(rm x):*",
    ]) {
      expect(ruleLevel("Bash", rule, classify, file), rule).toBe("any");
    }
  });

  test("an open rule is rated as the daemon rates the command itself", () => {
    expect(ruleLevel("Bash", "git status:*", classify, file)).toBe(
      classify("Bash", { command: "git status" }),
    );
  });
});

describe("rule-risk: a network rule names a host, or it covers any host (issue #384)", () => {
  test("a domain with two labels or more, with one leading `*.` at most, is rated as the tool", () => {
    for (const rule of [
      "domain:example.com",
      "domain:*.example.com",
      "domain:ab.example.co.uk",
      "domain:a-b.x1.io",
      "DOMAIN:EXAMPLE.COM",
      "domain:a.b",
    ]) {
      const { calls, classifyCall } = recorder();
      expect(ruleLevel("WebFetch", rule, classifyCall, file), rule).toBe("medium");
      expect(calls, rule).toEqual([{ tool: "WebFetch", input: {} }]);
    }
  });

  test("a rule with no content, no host, one label, a path, a port or another shape covers any host", () => {
    for (const rule of [
      undefined,
      "",
      "domain:",
      "domain:*",
      "domain:*.com",
      "domain:com",
      "domain:localhost",
      "domain:example.com/path",
      "domain:example.com:443",
      "domain:example.com extra",
      "domain:*example.com",
      "domain:**.example.com",
      "domain:a.*.com",
      "domain:example..com",
      "domain:exa_mple.com",
      "see domain:example.com",
      "example.com",
      "domain:example.com\n",
      "domain:*.*.example.com",
      "domain:example.com.",
    ]) {
      expect(ruleLevel("WebFetch", rule, classify, file), String(rule)).toBe("any");
    }
  });

  test("WebSearch is a network tool too", () => {
    expect(ruleLevel("WebSearch", "domain:example.com", classify, file)).not.toBe("any");
    expect(ruleLevel("WebSearch", "example.com", classify, file)).toBe("any");
  });
});

describe("rule-risk: a rule for a tool this check does not know is rated as the tool, not refused (issue #384)", () => {
  test("the tool's own rating, whatever the content", () => {
    const { calls, classifyCall } = recorder();
    expect(ruleLevel("TodoWrite", undefined, classifyCall, file)).toBe("medium");
    expect(ruleLevel("TodoWrite", "anything", classifyCall, file)).toBe("medium");
    expect(calls).toEqual([
      { tool: "TodoWrite", input: {} },
      { tool: "TodoWrite", input: {} },
    ]);
  });
});

describe("rule-risk: a path rule is rated on the path as the CLI reads it (issue #395)", () => {
  test("`//abs` is the absolute path; a single leading `/` is the project's root; a bare path stays as it is", () => {
    const probed = (rule: string) => {
      const { calls, classifyCall } = recorder();
      ruleLevel("Read", rule, classifyCall, file);
      return calls.map((call) => call.input.file_path);
    };
    expect(probed("//proj/a.ts")).toEqual(["/proj/a.ts"]);
    expect(probed("/a.ts")).toEqual(["a.ts"]);
    expect(probed("a.ts")).toEqual(["a.ts"]);
    // A bare path that ends with slashes keeps its first character: only `//abs` loses one.
    expect(probed("src//")[0]).toBe("src//");
  });

  test("each tool is asked about the keys it reads its path from: a write tool by `file_path`", () => {
    const { calls, classifyCall } = recorder();
    ruleLevel("Write", "a.ts", classifyCall, file);
    expect(calls).toEqual([{ tool: "Write", input: { file_path: "a.ts" } }]);
    const search = recorder();
    ruleLevel("Grep", "a.ts", search.classifyCall, file);
    expect(search.calls).toEqual([{ tool: "Grep", input: { path: "a.ts" } }]);
  });

  test("a path whose real path could not be read is refused, and one with a real path is rated on both", () => {
    expect(ruleLevel("Read", "a.ts", classify, file, () => null)).toBe("any");
    expect(
      ruleLevel("Read", "a.ts", classify, file, (reading) =>
        reading === "a.ts" ? "/home/me/.ssh/id_rsa" : undefined,
      ),
    ).toBe("high");
    const { calls, classifyCall } = recorder();
    ruleLevel("Read", "a.ts", classifyCall, file, () => "/elsewhere/a.ts");
    expect(calls.map((call) => call.input.file_path).sort()).toEqual(["/elsewhere/a.ts", "a.ts"]);
  });

  test("up to six wildcards are looked at; seven are too many to show narrow", () => {
    expect(ruleLevel("Read", "//proj/a*/b*/c*/d*/e*/f*.ts", classify, file)).toBe("low");
    expect(ruleLevel("Read", "//proj/a*/b*/c*/d*/e*/f*/g*.ts", classify, file)).toBe("any");
  });

  test("a wildcard that can be a credential makes the rule not narrow; a plain one stays low", () => {
    expect(ruleLevel("Read", "//proj/src/*", classify, folder)).toBe("any");
    expect(ruleLevel("Read", "//proj/src/app-?.ts", classify, folder)).toBe("low");
  });
});

describe("rule-risk: what pathKinds looks up (issue #395)", () => {
  const spy = () => {
    const asked: string[] = [];
    return {
      asked,
      stat: async (path: string) => {
        asked.push(path);
        return "file" as const;
      },
    };
  };

  test("a lone `~` is the home; a `~` inside a path is just a name", async () => {
    const { asked, stat } = spy();
    await pathKinds(["~", "src/~/x"], PROJECT, HOME, stat);
    expect([...asked].sort()).toEqual([join(PROJECT, "src", "~", "x"), join(HOME)].sort());
  });

  test("a path with a double slash inside is not a network path; one that starts with it is", async () => {
    const { asked, stat } = spy();
    const kind = await pathKinds(["a//b", "//host/share", "\\\\host\\share"], PROJECT, HOME, stat);
    expect(asked).toEqual([join(PROJECT, "a", "b")]);
    expect([kind("a//b"), kind("//host/share"), kind("\\\\host\\share")]).toEqual([
      "file",
      "dir",
      "dir",
    ]);
  });

  test("writeTarget is nothing for an empty path", () => {
    expect(writeTarget("Write", { file_path: "" })).toBeUndefined();
    expect(writeTarget("NotebookEdit", { notebook_path: "" })).toBeUndefined();
  });
});

describe("rule-risk: realPaths writes a real path back under the folder or the home only when it is inside one (issue #528)", () => {
  const disk = (links: Record<string, string | null>) => async (path: string) =>
    path in links ? (links[path] ?? null) : path;

  test("a real path outside both is returned as it is, from a project far down the tree", async () => {
    const cwd = "/a/b/c/d";
    const resolve = disk({ [cwd]: "/r", [join(cwd, "lib")]: "/elsewhere/lib" });
    const looked = await realPaths(["lib"], cwd, HOME, resolve);
    expect(looked("lib")).toBe("/elsewhere/lib");
  });

  test("a folder that cannot be resolved does not stop the home from being used", async () => {
    const resolve = disk({
      [PROJECT]: null,
      [join(HOME, "notes")]: "/real/me/.ssh",
      [HOME]: "/real/me",
    });
    const looked = await realPaths(["~/notes"], PROJECT, HOME, resolve);
    expect(looked("~/notes")).toBe(join(HOME, ".ssh"));
  });

  test("a wildcard in the first segment and a network path are not looked up; the fixed folder before a later wildcard is", async () => {
    const asked: string[] = [];
    const resolve = async (path: string) => {
      asked.push(path);
      return path;
    };
    const looked = await realPaths(["*.ts", "//host/x", "src/*"], PROJECT, HOME, resolve);
    expect([looked("*.ts"), looked("//host/x"), looked("src/*")]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect([...asked].sort()).toEqual([HOME, PROJECT, join(PROJECT, "src")].sort());
  });

  test("a relative fixed part with no folder to start from is refused", async () => {
    const looked = await realPaths(["a.ts"], "", "", async (path) => path);
    expect(looked("a.ts")).toBeNull();
  });
});
