import { describe, expect, test } from "bun:test";
import { isTarget, migrate, waitPathFor } from "../../lib/tests/migrate-esperas.ts";

const DEF = (
  timeout: string,
  sleep: string,
) => `async function settle(check: () => boolean, timeoutMs = ${timeout}): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await ${sleep};
}
`;

const FILE = (def: string) => `import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { act } = await import("@testing-library/react");

${def}
describe("x", () => {
  test("y", async () => {
    await settle(() => true);
  });
});
`;

describe("migrate-esperas: a file's own settle becomes the shared one", () => {
  test("a 5000 ms settle in act is replaced by the shared settle, with its import", () => {
    const out = migrate(FILE(DEF("5000", "act(() => Bun.sleep(10))"))) as string;
    expect(out).toContain('import { settle } from "./wait.ts";');
    expect(out).not.toContain("function settle");
    expect(out).not.toContain("const deadline");
    expect(out).toContain("await settle(() => true);");
    // The import sits with the other static imports, before the code.
    expect(out.indexOf('from "./wait.ts"')).toBeLessThan(out.indexOf("registerDom();"));
  });

  test("another default timeout (with an underscore too) is kept through waiter()", () => {
    const out = migrate(FILE(DEF("15_000", "act(() => Bun.sleep(5))"))) as string;
    expect(out).toContain('import { waiter } from "./wait.ts";');
    expect(out).toContain("const settle = waiter(15_000);");
  });

  test("a settle that sleeps without act becomes the plain one", () => {
    const same = migrate(FILE(DEF("5000", "Bun.sleep(10)"))) as string;
    expect(same).toContain('import { settlePlain as settle } from "./wait.ts";');
    const other = migrate(FILE(DEF("3000", "Bun.sleep(10)"))) as string;
    expect(other).toContain('import { plainWaiter } from "./wait.ts";');
    expect(other).toContain("const settle = plainWaiter(3000);");
  });

  test("the import path is the one given, for a file in a subfolder", () => {
    const out = migrate(FILE(DEF("5000", "act(() => Bun.sleep(10))")), "../wait.ts") as string;
    expect(out).toContain('from "../wait.ts"');
  });

  test("a file with no such settle, or already migrated, is left alone", () => {
    expect(migrate('import { x } from "y";\nconsole.log(x);\n')).toBeNull();
    const done = migrate(FILE(DEF("5000", "act(() => Bun.sleep(10))"))) as string;
    expect(migrate(done)).toBeNull();
  });
});

describe("migrate-esperas: test folders", () => {
  test("a file at the top of the test folder imports the shared module from its own folder", () => {
    expect(waitPathFor("hosts.test.tsx")).toBe("./wait.ts");
  });

  test("a file in a domain folder imports the shared module from the folder above", () => {
    expect(waitPathFor("hosts/overview.test.tsx")).toBe("../wait.ts");
  });

  test("a file two folders deep climbs two folders", () => {
    expect(waitPathFor("hosts/panels/overview.test.tsx")).toBe("../../wait.ts");
  });

  test("tests and helpers in any folder are read, and so are .ts and .tsx", () => {
    expect([
      isTarget("a.test.ts"),
      isTarget("hosts/a.test.tsx"),
      isTarget("hosts/ui-setup.ts"),
    ]).toEqual([true, true, true]);
  });

  test("the shared module at the top of the test folder is not read, its neighbours are", () => {
    expect([isTarget("wait.ts"), isTarget("dom.ts")]).toEqual([false, true]);
  });

  test("a wait.ts inside a domain folder is read, and files that are not TypeScript are not", () => {
    expect([
      isTarget("hosts/wait.ts"),
      isTarget("fixtures/data.json"),
      isTarget("notes.md"),
    ]).toEqual([true, false, false]);
  });
});
