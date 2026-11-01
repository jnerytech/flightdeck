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
  return {
    retries: 0,
    workers: 0,
    fullyParallel: true,
    forbidOnly: false,
    reporter: [],
    use: { trace: "off", screenshot: "off", video: "off" },
    outputDir: "",
  };
}

/** The `--grep` for `E2E_ONLY=a,b`: test titles end in the journey name, after the language. */
export function grepFor(only: string | undefined): RegExp | undefined {
  return only ? /x/ : undefined;
}
