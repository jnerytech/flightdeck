import { tmpdir } from "node:os";
import { join } from "node:path";

/** Settings of the e2e runner (`@playwright/test`), kept here so they are unit tested. */

export const E2E_TEST_DIR = "scripts/e2e";
export const E2E_TEST_MATCH = "**/*.e2e.ts";

export interface RunnerSettings {
  retries: number;
  workers: number;
  fullyParallel: boolean;
  forbidOnly: boolean;
  reporter: Array<[string] | [string, Record<string, unknown>]>;
  use: { trace: string; screenshot: string; video: string };
  outputDir: string;
}

export function runnerSettings(env: Record<string, string | undefined>): RunnerSettings {
  const ci = Boolean(env.CI);
  const reporter: RunnerSettings["reporter"] = [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ];
  if (ci) reporter.push(["github"]);
  return {
    // A retried pass is reported as flaky, never hidden.
    retries: ci ? 1 : 0,
    // The journeys share the seeded demo, and the second language relies on the first one's state.
    workers: 1,
    fullyParallel: false,
    forbidOnly: ci,
    reporter,
    use: {
      trace: "retain-on-failure",
      screenshot: "only-on-failure",
      video: "retain-on-failure",
    },
    outputDir: env.E2E_FAILURES || join(tmpdir(), "flightdeck-e2e"),
  };
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The `--grep` for `E2E_ONLY=a,b`: test titles end in the journey name, after the language. */
export function grepFor(only: string | undefined): RegExp | undefined {
  const names = (only ?? "").split(",").filter(Boolean);
  if (names.length === 0) return undefined;
  return new RegExp(`(^| )(${names.map(escapeRegExp).join("|")})$`);
}
