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

export interface HandoffDeps {
  run: (command: string[]) => Promise<number>;
  branch: string;
  head: string;
  now: string;
  /** `--base`: test:related compares with this ref (a branch stacked on another, #266). */
  base?: string;
  /** The CI of HEAD: "0" when the required checks are green, else why not (#266). */
  ci?: () => Promise<string>;
  /** The security gate (lib/security-gate.ts): "0", or "unreviewed" (#273). */
  security?: () => Promise<string>;
}

/** Runs every step (all of them, so one run shows every failure) and builds the stamp line. */
export async function runHandoff({
  run,
  branch,
  head,
  now,
  base,
  ci,
  security,
}: HandoffDeps): Promise<{
  code: number;
  stamp: string;
}> {
  const codes: string[] = [];
  let failed = false;
  for (const [name, command] of STEPS) {
    const code = await run(name === "related" && base ? [...command, "--base", base] : command);
    failed ||= code !== 0;
    codes.push(`${name}=${code}`);
  }
  if (security) {
    const verdict = await security();
    failed ||= verdict !== "0";
    codes.push(`security=${verdict}`);
  }
  if (ci) {
    const verdict = await ci();
    failed ||= verdict !== "0";
    codes.push(`ci=${verdict}`);
  }
  return { code: failed ? 1 : 0, stamp: `HANDOFF ${branch} ${head} ${codes.join(" ")} ${now}` };
}

// Pairs are separated by exactly one space: with an optional one, a digit could end a pair or start
// the next, and a stamp that does not match backtracked 2^n times (Sonar S5852).
// A value is a word (ci=pending), never a space, so the pairs still split one way only.
const STAMP = /^HANDOFF (\S+) ([0-9a-f]{7,40}) (\w+=[\w-]+(?: \w+=[\w-]+)*) (\S+)$/;

/** Why a stamp does not vouch for this HEAD, or null when it does. */
export function stampProblem(stamp: string | null, head: string): string | null {
  if (stamp === null) return "no stamp: run bun run handoff:check in the worktree";
  const m = STAMP.exec(stamp.trim());
  if (!m) return `not a stamp: ${stamp.trim().slice(0, 80)}`;
  if (m[2] !== head) return `stale: the stamp is for ${m[2]}, HEAD is ${head}`;
  const failed = (m[3] ?? "").split(" ").filter((pair) => pair && !pair.endsWith("=0"));
  if (failed.length > 0) return `failed: ${failed.join(" ")}`;
  // A stamp from before the gate (or one with a field dropped) vouches for nothing (#273).
  const keys = (m[3] ?? "").split(" ").map((pair) => pair.split("=")[0]);
  for (const key of ["security", "ci"]) {
    if (!keys.includes(key)) return `incomplete: no ${key}= in the stamp`;
  }
  return null;
}
