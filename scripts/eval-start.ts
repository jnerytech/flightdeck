/**
 * The start both evals share (`scripts/harness-eval.ts`, `scripts/ux-review-eval.ts`): the options,
 * the platform refusal, claude on the PATH and a runner whose processes get only the filtered env
 * (scripts/lib/harness-eval.ts). It exits with 2, naming the eval, when one cannot start. Only the
 * real effects live here; the logic is evalOptions and evalContext, tested with fakes.
 */
import { spawnSync } from "node:child_process";
import { whichOnPath } from "../apps/daemon/src/which.ts";
import {
  type EvalContext,
  type EvalHost,
  type EvalOptions,
  evalContext,
  evalOptions,
} from "./lib/harness-eval.ts";

const spawn: EvalHost["spawn"] = (command, cwd, env) => {
  const proc = spawnSync(command[0] ?? "", command.slice(1), {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  return { code: proc.status ?? 1, out: proc.stdout ?? "" };
};

/** The options and context of the eval `tag` from `argv`; exits with 2 when it cannot start. */
export function startEval(tag: string, argv: string[]): EvalOptions & EvalContext {
  const options = evalOptions(argv);
  const context =
    typeof options === "string"
      ? `${tag}: ${options}`
      : evalContext(tag, {
          platform: process.platform,
          which: whichOnPath,
          spawn,
          cwd: process.cwd(),
          env: process.env,
        });
  if (typeof options === "string" || typeof context === "string") {
    console.error(context);
    process.exit(2);
  }
  return { ...options, ...context };
}
