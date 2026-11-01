import { statSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";
import { browserLaunch, whichOnNodePath } from "../lib/browser.ts";
import { E2E_TEST_DIR, E2E_TEST_MATCH, grepFor, runnerSettings } from "../lib/e2e-config.ts";

const isFile = (path: string) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};
const which = (name: string) => whichOnNodePath(name, process.env, process.platform, isFile);

const { use, outputDir, ...settings } = runnerSettings(process.env);

export default defineConfig({
  ...settings,
  testDir: resolve(import.meta.dirname, "../..", E2E_TEST_DIR),
  testMatch: E2E_TEST_MATCH,
  outputDir,
  grep: grepFor(process.env.E2E_ONLY),
  timeout: 90_000,
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  use: { ...use, launchOptions: browserLaunch(which), headless: true },
});
