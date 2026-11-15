import type { GhResult } from "../../lib/ci/branch.ts";

/**
 * Issue #1246: a red main is claimed once. Every `gh` here is a fake that answers by its
 * arguments and records what was asked; nothing reaches GitHub.
 */

export const RED_RUN = {
  databaseId: 7,
  conclusion: "failure",
  createdAt: "2026-11-08T21:07:02Z",
  url: "https://github.com/o/r/actions/runs/7",
};
export const GREEN_RUN = {
  databaseId: 9,
  conclusion: "success",
  createdAt: "2026-11-08T22:00:00Z",
  url: "https://github.com/o/r/actions/runs/9",
};
export const LOG = [
  "test\tRun tests\t2026-11-08T21:10:00Z (fail) protocolo-compat > host.info traz os recursos [77.35ms]",
  "test\tRun tests\t2026-11-08T21:10:01Z (fail) protocolo-compat > host.info traz os recursos [77.35ms]",
  "test\tRun tests\t2026-11-08T21:10:02Z (fail) card detail > opens on changes [3.10ms]",
].join("\n");

/** An open claim as the tool writes it. */
export function issue(
  number: number,
  owner: string,
  failing: string[],
  cause = "typecheck",
  jobs: string[] = [],
) {
  return {
    number,
    title: `main red: ${cause}`,
    body: [
      `Cause: ${cause}`,
      `Owner: ${owner}`,
      "Run: https://github.com/o/r/actions/runs/7",
      "Run at: 2026-11-08T21:07:02Z",
      `Jobs: ${JSON.stringify(jobs)}`,
      "Failing:",
      ...failing.map((f) => `- ${f}`),
    ].join("\n"),
  };
}

export function fakeGh(opts: {
  runs?: object[];
  claims?: object[];
  log?: string;
  jobs?: object[];
  createFails?: string;
  /** What `issue list` answers once an issue was created (a claim made at the same moment). */
  claimsAfterCreate?: object[];
  /** `run list` answers this text instead of JSON (an auth prompt, a proxy page). */
  runsText?: string;
  /** `issue list` answers this text instead of JSON. */
  claimsText?: string;
  /** #1381: `run list --event schedule` and `--event workflow_dispatch` (main's full runs). */
  schedule?: object[];
  dispatch?: object[];
  /** `run view <id>`'s jobs and failed log, by run id (else `jobs` and `log`). */
  jobsById?: Record<number, object[]>;
  logById?: Record<number, string>;
  /** Run ids whose `run view --json jobs` fails. */
  jobsFail?: number[];
  /** The full runs' lists fail (`run list --event schedule|workflow_dispatch`). */
  fullFail?: boolean;
}) {
  let madeOne = false;
  const asked: string[][] = [];
  // How many gh calls were in flight at once (#1381: the warning asks GitHub in parallel).
  let active = 0;
  let peak = 0;
  const answer = async (args: string[]): Promise<GhResult> => {
    active++;
    peak = Math.max(peak, active);
    await Promise.resolve();
    active--;
    return reply(args);
  };
  const reply = (args: string[]): GhResult => {
    asked.push(args);
    const line = args.join(" ");
    const event = args.includes("--event") ? args[args.indexOf("--event") + 1] : undefined;
    if (line.startsWith("run list") && event && event !== "push" && opts.fullFail) {
      return { code: 1, stdout: "", stderr: "HTTP 502" };
    }
    if (line.startsWith("run list") && event && event !== "push") {
      const full = event === "schedule" ? opts.schedule : opts.dispatch;
      return { code: 0, stdout: JSON.stringify(full ?? []) };
    }
    if (line.startsWith("run list")) {
      return { code: 0, stdout: opts.runsText ?? JSON.stringify(opts.runs ?? []) };
    }
    const id = Number(args[2]);
    if (line.startsWith("run view") && args.includes("--log-failed")) {
      return { code: 0, stdout: opts.logById?.[id] ?? opts.log ?? "" };
    }
    if (line.startsWith("run view") && opts.jobsFail?.includes(id)) {
      return { code: 1, stdout: "", stderr: "HTTP 502" };
    }
    if (line.startsWith("run view")) {
      return { code: 0, stdout: JSON.stringify({ jobs: opts.jobsById?.[id] ?? opts.jobs ?? [] }) };
    }
    if (line.startsWith("issue list")) {
      if (opts.claimsText !== undefined) return { code: 0, stdout: opts.claimsText };
      const listed = madeOne && opts.claimsAfterCreate ? opts.claimsAfterCreate : opts.claims;
      return { code: 0, stdout: JSON.stringify(listed ?? []) };
    }
    if (line.startsWith("issue create")) {
      if (opts.createFails) return { code: 1, stdout: "", stderr: opts.createFails };
      madeOne = true;
      return { code: 0, stdout: "https://github.com/o/r/issues/31\n" };
    }
    if (line.startsWith("issue close")) return { code: 0, stdout: "" };
    return { code: 1, stdout: "", stderr: `unexpected gh ${line}` };
  };
  return { gh: answer, asked, peak: () => peak };
}

export const created = (asked: string[][]) =>
  asked.filter((a) => a[0] === "issue" && a[1] === "create");
