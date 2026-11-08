import { describe, expect, test } from "bun:test";
import { type GhIn, listAlerts, PER_SOURCE } from "../src/github/alerts.ts";

/** #197 (Sonar S4624): the package line of a Dependabot alert, with and without a manifest, as it read before the rewrite. */
const DEPENDABOT = `repos/{owner}/{repo}/dependabot/alerts?state=open&per_page=${PER_SOURCE}`;

const textOf = async (dependency: Record<string, unknown>) => {
  const alert = {
    number: 7,
    state: "open",
    security_advisory: { summary: "Bad parse", severity: "high", description: "Details here" },
    dependency,
    html_url: "https://github.com/o/r/security/dependabot/7",
  };
  const gh: GhIn = async (args) =>
    args[1] === DEPENDABOT ? { code: 0, stdout: JSON.stringify([alert]), stderr: "" } : null;
  return (await listAlerts(gh, "/work")).alerts[0]?.text;
};

describe("sonar197-nested-templates: a Dependabot alert's package line", () => {
  test("names the package and its manifest, the package alone, or leaves the line out", async () => {
    const head = "Dependabot alert #7 (high): Bad parse";
    const tail = "https://github.com/o/r/security/dependabot/7\nDetails here";
    expect(await textOf({ package: { name: "lodash" }, manifest_path: "package.json" })).toBe(
      `${head}\nPackage: lodash (package.json)\n${tail}`,
    );
    expect(await textOf({ package: { name: "lodash" } })).toBe(`${head}\nPackage: lodash\n${tail}`);
    expect(await textOf({ manifest_path: "package.json" })).toBe(`${head}\n${tail}`);
  });
});
