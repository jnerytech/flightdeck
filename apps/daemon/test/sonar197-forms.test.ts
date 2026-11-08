import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { refusalCounts } from "../../../scripts/lib/refusal-ratchet.ts";
import { type GhIn, listAlerts, PER_SOURCE } from "../src/github/alerts.ts";
import { inspectPlugin } from "../src/plugins/inventory.ts";
import { tempDir } from "./helpers.ts";

/**
 * Issue #197 (Sonar S3358, S4043, S6557): small rewrites that keep what they answered. Each answer
 * is pinned here with inputs the old form and the new one read the same way.
 */
const CODE = `repos/{owner}/{repo}/code-scanning/alerts?state=open&per_page=${PER_SOURCE}`;

const locationOf = async (instance: Record<string, unknown>) => {
  const alert = {
    number: 1,
    state: "open",
    rule: { id: "r", severity: "error", description: "A rule" },
    most_recent_instance: instance,
    html_url: "https://github.com/o/r/security/code-scanning/1",
  };
  const gh: GhIn = async (args) =>
    args[1] === CODE ? { code: 0, stdout: JSON.stringify([alert]), stderr: "" } : null;
  return (await listAlerts(gh, "/work")).alerts[0]?.location;
};

describe("sonar197-forms: where a code-scanning alert is", () => {
  test("the path and the line, the path alone, or nowhere", async () => {
    expect(await locationOf({ location: { path: "src/db.ts", start_line: 41 } })).toBe(
      "src/db.ts:41",
    );
    expect(await locationOf({ location: { path: "src/db.ts" } })).toBe("src/db.ts");
    expect(await locationOf({ location: { start_line: 41 } })).toBeNull();
    expect(await locationOf({})).toBeNull();
  });
});

describe("sonar197-forms: refusals are counted in .ts files only", () => {
  test("a .tsx file and a name that only contains .ts are left out", () => {
    const root = tempDir("fd-refusals-");
    const bad = 'throw new FlightdeckError("bad_request", "x");\n';
    for (const name of ["a.ts", "sub/b.ts", "c.tsx", "d.ts.map", "e.tsx.ts", "ts"]) {
      mkdirSync(dirname(join(root, name)), { recursive: true });
      writeFileSync(join(root, name), bad);
    }
    expect(refusalCounts(root, root)).toEqual({ "a.ts": 1, "sub/b.ts": 1, "e.tsx.ts": 1 });
  });
});

describe("sonar197-forms: a plugin's skills and agents are listed by name", () => {
  test("in code-unit order whatever order the folder gives", async () => {
    const dir = join(tempDir("fd-plugin-"), "p");
    const named = (name: string) => `---\nname: ${name}\ndescription: d\n---\nx\n`;
    for (const name of ["m", "c", "x", "a", "q", "e"]) {
      mkdirSync(join(dir, "skills", name), { recursive: true });
      writeFileSync(join(dir, "skills", name, "SKILL.md"), named(name));
      mkdirSync(join(dir, "agents"), { recursive: true });
      writeFileSync(join(dir, "agents", `${name}.md`), named(name));
    }
    writeFileSync(join(dir, "plugin.json"), "{}");
    const inventory = await inspectPlugin(dir);
    expect(inventory.skills).toEqual(["a", "c", "e", "m", "q", "x"]);
    expect(inventory.agents).toEqual(["a", "c", "e", "m", "q", "x"]);
  });
});
