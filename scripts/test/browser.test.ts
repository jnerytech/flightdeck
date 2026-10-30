import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BrowserAttempt, browserAttempts, launchFirst } from "../lib/browser.ts";

const realPath = process.env.PATH;
afterEach(() => {
  process.env.PATH = realPath;
});

/** A PATH made of one folder holding empty executables with these names (nothing is launched). */
function onlyOnPath(...names: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "fd-browser-"));
  for (const name of names) {
    writeFileSync(join(dir, name), "#!/bin/sh\n");
    chmodSync(join(dir, name), 0o755);
  }
  process.env.PATH = dir;
  return dir;
}

describe("browser: where the demo scripts get a Chromium", () => {
  test("tries Chrome, then Edge, and the distribution's Chromium last when it is on the PATH", () => {
    const dir = onlyOnPath("chromium-browser");
    expect(browserAttempts()).toEqual([
      { channel: "chrome" },
      { channel: "msedge" },
      { executablePath: join(dir, "chromium-browser") },
    ]);
  });

  test("prefers `chromium` over `chromium-browser`", () => {
    const dir = onlyOnPath("chromium-browser", "chromium");
    expect(browserAttempts().at(-1)).toEqual({ executablePath: join(dir, "chromium") });
  });

  test("without a Chromium on the PATH there are only the two channels", () => {
    onlyOnPath();
    expect(browserAttempts()).toEqual([{ channel: "chrome" }, { channel: "msedge" }]);
  });

  test("launchFirst returns the first attempt that works and stops there", async () => {
    const tried: BrowserAttempt[] = [];
    const browser = await launchFirst(
      async (attempt) => {
        tried.push(attempt);
        if ("channel" in attempt && attempt.channel === "chrome") throw new Error("refused");
        return `launched ${JSON.stringify(attempt)}`;
      },
      () => "/opt/chromium",
    );
    expect(browser).toBe('launched {"channel":"msedge"}');
    expect(tried).toEqual([{ channel: "chrome" }, { channel: "msedge" }]);
  });

  test("launchFirst fails with every reason when no attempt works", async () => {
    const attempts = launchFirst(
      async (attempt) => {
        throw new Error("no " + ("channel" in attempt ? attempt.channel : attempt.executablePath));
      },
      () => "/opt/chromium",
    );
    await expect(attempts).rejects.toThrow("no chrome; no msedge; no /opt/chromium");
  });
});
