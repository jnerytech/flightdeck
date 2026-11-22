import { describe, expect, test } from "bun:test";
import { projectScopeName } from "../../lib/e2e/scope-name.ts";

const menu = (scope: string) => `Data from ${scope}`;
const matches = (label: string, scope: string) => projectScopeName(menu, label).test(menu(scope));

describe("projectScopeName: the Data from button names the project Home showed (#3836)", () => {
  test("the same label matches", () => {
    expect(matches("docs-site", "docs-site")).toBe(true);
  });

  test("a host added after Home was read still matches", () => {
    expect(matches("docs-site", "docs-site · alfa")).toBe(true);
  });

  test("a parent folder added after Home was read still matches", () => {
    expect(matches("docs-site", "projects/docs-site")).toBe(true);
  });

  test("another project does not match, even when it ends or starts like the label", () => {
    expect([
      matches("docs-site", "api-gateway"),
      matches("docs-site", "my-docs-site"),
      matches("docs-site", "docs-site-2"),
      matches("docs-site", "docs-site·alfa"),
    ]).toEqual([false, false, false, false]);
  });

  test("a label with regular expression characters is matched as text", () => {
    expect([matches("a.b (v1)+", "a.b (v1)+"), matches("a.b (v1)+", "aXb (v1)+")]).toEqual([
      true,
      false,
    ]);
  });

  test("accents and emoji in the label match as written", () => {
    expect(matches("café 🙂", "café 🙂 · alfa")).toBe(true);
  });

  test("text after the name in the dictionary's sentence is kept", () => {
    const after = (scope: string) => `Dados de ${scope} (filtro)`;
    expect([
      projectScopeName(after, "docs-site").test(after("docs-site · alfa")),
      projectScopeName(after, "docs-site").test("Dados de docs-site"),
    ]).toEqual([true, false]);
  });

  test("a folder or a host with a space in its name is still matched", () => {
    expect([
      matches("docs-site", "My Projects/docs-site"),
      matches("docs-site", "docs-site · build box"),
      matches("docs-site", "a/b/docs-site · alfa"),
    ]).toEqual([true, true, true]);
  });

  test("a project of another name with the same host or folder does not match", () => {
    expect([
      matches("docs-site", "web/api-gateway · alfa"),
      matches("docs-site", "docs-site · alfa · beta"),
    ]).toEqual([false, false]);
  });

  test("a sentence that names the scope twice is refused, not half-matched", () => {
    expect(() => projectScopeName((scope) => `${scope} of ${scope}`, "docs-site")).toThrow(
      "scope.menu",
    );
  });
});
