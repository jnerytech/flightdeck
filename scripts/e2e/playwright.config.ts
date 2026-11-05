import { statSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";
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

const repoRoot = resolve(import.meta.dirname, "../..");
const { use, outputDir, ...settings } = runnerSettings(process.env, repoRoot);

/**
 * The scenarios: one English feature per behaviour, run once per app language (a project each, so a
 * report names the language). `bddgen` turns the features into tests first, once for each project.
 */
const bdd = (language: "pt-BR" | "en") =>
  defineBddConfig({
    features: "bdd/features/*.feature",
    steps: ["bdd/fixtures.ts", "bdd/steps.ts"],
    outputDir: `.features-gen/${language}`,
  });
const viewport = { width: 1280, height: 800 };

export default defineConfig({
  ...settings,
  projects: [
    {
      name: "journeys",
      testDir: resolve(repoRoot, E2E_TEST_DIR),
      testMatch: E2E_TEST_MATCH,
    },
    { name: "bdd-pt", testDir: bdd("pt-BR"), timeout: 180_000, use: { locale: "pt-BR", viewport } },
    { name: "bdd-en", testDir: bdd("en"), timeout: 180_000, use: { locale: "en", viewport } },
  ],
  outputDir,
  grep: grepFor(process.env.E2E_ONLY),
  timeout: 90_000,
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  use: {
    ...use,
    launchOptions: browserLaunch(which, { env: process.env, platform: process.platform, isFile }),
    headless: true,
  },
});
