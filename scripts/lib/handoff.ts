/**
 * `bun run handoff:check` (issue #169, D4): the four checks every hand-off needs, run in order,
 * and one stamp line the session pastes into its hand-off message. The receiver checks the stamp
 * against the branch's HEAD with `--verify`; no hook reads messages.
 */

/** The checks, by name, in the order they run. */
export const STEPS: [string, string[]][] = [
  ["typecheck", ["bun", "run", "typecheck"]],
  ["lint", ["bun", "run", "lint"]],
  ["audit", ["bun", "run", "tdd:audit"]],
  ["related", ["bun", "run", "test:related", "--", "--fast"]],
];

/** The steps with a base for the audit and test:related (an rc-based branch passes its rc). */
export function steps(base?: string): [string, string[]][] {
  if (!base) return STEPS;
  return STEPS.map(([name, command]): [string, string[]] => {
    if (name === "audit") return [name, [...command, "--", "--since", base]];
    if (name === "related") return [name, [...command, "--base", base]];
    return [name, command];
  });
}

/** Whether a ci.yml runs on a push to any branch (#217), so a pushed branch gets its CI. */
export function pushTrigger(ciYaml: string | null): boolean {
  try {
    const on = (Bun.YAML.parse(ciYaml ?? "") as { on?: { push?: { branches?: unknown } } })?.on;
    const branches = on?.push?.branches;
    return Array.isArray(branches) && branches.includes("**");
  } catch {
    return false;
  }
}

/**
 * The CI state of HEAD from `gh run list --commit <sha> --json status,conclusion`: "0" when a run
 * passed, else "pending", "failed", "none" or "unknown" (gh could not say).
 */
export function ciVerdict(runList: string | null): string {
  let list: { status?: string; conclusion?: string | null }[];
  try {
    list = JSON.parse(runList ?? "");
  } catch {
    return "unknown";
  }
  if (!Array.isArray(list)) return "unknown";
  if (list.length === 0) return "none";
  if (list.some((r) => r.status === "completed" && r.conclusion === "success")) return "0";
  if (list.some((r) => r.status !== "completed")) return "pending";
  return "failed";
}

export interface HandoffDeps {
  run: (command: string[]) => Promise<number>;
  branch: string;
  head: string;
  now: string;
  /** The base for the audit and test:related; the audit base when absent. */
  base?: string;
  /** The CI state of HEAD ("0" when green); absent, no CI check is made. */
  ci?: () => Promise<string>;
}

/** Runs every step (all of them, so one run shows every failure) and builds the stamp line. */
export async function runHandoff({ run, branch, head, now, base, ci }: HandoffDeps): Promise<{
  code: number;
  stamp: string;
}> {
  const codes: string[] = [];
  let failed = false;
  for (const [name, command] of steps(base)) {
    const code = await run(command);
    failed ||= code !== 0;
    codes.push(`${name}=${code}`);
  }
  if (ci) {
    // The heavy tier (#216): the full suite on both systems, prints and e2e ran in CI for HEAD.
    const state = await ci();
    failed ||= state !== "0";
    codes.push(`ci=${state}`);
  }
  return { code: failed ? 1 : 0, stamp: `HANDOFF ${branch} ${head} ${codes.join(" ")} ${now}` };
}

const STAMP = /^HANDOFF (\S+) ([0-9a-f]{7,40}) ((?:\w+=[\w-]+ ?)+) (\S+)$/;

/** Why a stamp does not vouch for this HEAD, or null when it does. */
export function stampProblem(stamp: string | null, head: string): string | null {
  if (stamp === null) return "no stamp: run bun run handoff:check in the worktree";
  const m = STAMP.exec(stamp.trim());
  if (!m) return `not a stamp: ${stamp.trim().slice(0, 80)}`;
  if (m[2] !== head) return `stale: the stamp is for ${m[2]}, HEAD is ${head}`;
  const failed = (m[3] ?? "").split(" ").filter((pair) => pair && !pair.endsWith("=0"));
  return failed.length === 0 ? null : `failed: ${failed.join(" ")}`;
}
