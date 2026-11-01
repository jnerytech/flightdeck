import { describe, expect, test } from "bun:test";
import {
  E2E_TEST_DIR,
  E2E_TEST_MATCH,
  grepFor,
  runnerSettings,
} from "../lib/e2e-config.ts";

describe("e2e runner settings", () => {
  test("on CI a failed journey is retried once, and a retried pass is kept as flaky", () => {
    const ci = runnerSettings({ CI: "true" });
    expect(ci.retries).toBe(1);
    expect(ci.forbidOnly).toBe(true);
    expect(runnerSettings({}).retries).toBe(0);
    expect(runnerSettings({}).forbidOnly).toBe(false);
  });

  test("journeys run one at a time, in file order: the second language relies on the first's state", () => {
    const settings = runnerSettings({});
    expect(settings.workers).toBe(1);
    expect(settings.fullyParallel).toBe(false);
  });

  test("a failure keeps a trace, a print and a video; a pass keeps nothing", () => {
    expect(runnerSettings({}).use).toEqual({
      trace: "retain-on-failure",
      screenshot: "only-on-failure",
      video: "retain-on-failure",
    });
  });

  test("the reports are the list, the HTML report (never opened) and, on CI, the github annotations", () => {
    expect(runnerSettings({}).reporter).toEqual([
      ["list"],
      ["html", { open: "never", outputFolder: "playwright-report" }],
    ]);
    expect(runnerSettings({ CI: "1" }).reporter).toEqual([
      ["list"],
      ["html", { open: "never", outputFolder: "playwright-report" }],
      ["github"],
    ]);
  });

  test("E2E_FAILURES chooses where the traces, prints and videos go", () => {
    expect(runnerSettings({ E2E_FAILURES: "out/fail" }).outputDir).toBe("out/fail");
    expect(runnerSettings({}).outputDir).toMatch(/flightdeck-e2e$/);
  });
});

describe("E2E_ONLY", () => {
  test("no filter, no grep", () => {
    expect(grepFor(undefined)).toBeUndefined();
    expect(grepFor("")).toBeUndefined();
  });

  test("a list of journeys matches the titles that end in one of them, in either language", () => {
    const grep = grepFor("voltar-arquivos,clientes") as RegExp;
    expect(grep.test("pt-BR voltar-arquivos")).toBe(true);
    expect(grep.test("en clientes")).toBe(true);
    expect(grep.test("en acoes")).toBe(false);
    expect(grep.test("en voltar-arquivos-extra")).toBe(false);
  });

  test("a name is matched literally", () => {
    const grep = grepFor("a.b") as RegExp;
    expect(grep.test("en a.b")).toBe(true);
    expect(grep.test("en axb")).toBe(false);
  });
});

describe("where the journeys live", () => {
  test("the files are *.e2e.ts, which bun test never picks up", () => {
    expect(E2E_TEST_DIR).toBe("scripts/e2e");
    expect(E2E_TEST_MATCH).toBe("**/*.e2e.ts");
    // bun test runs *.test.*, *_test.*, *.spec.* and *_spec.*
    const bunTest = /(\.|_)(test|spec)\.[cm]?[jt]sx?$/;
    expect(bunTest.test("scripts/e2e/journeys.e2e.ts")).toBe(false);
    expect(bunTest.test("scripts/test/e2e-config.test.ts")).toBe(true);
  });
});
