import { describe, expect, test } from "bun:test";
import { migrate } from "../lib/migrate-esperas.ts";

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
