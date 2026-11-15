/**
 * The heavy-run rules of the guard: a full run (the suite, e2e, the prints, the smokes, the builds)
 * outside `bun run slot --` (CLAUDE.md), and a worker's full coverage run (#674, #687). Who may
 * run what is decided here, so these rules live apart from the other guard rules.
 */
import { HEAVY_TESTS, heavyReasonGiven, heavyRunMessage } from "../slot/heavy.ts";
import { commandWords, prefixAssignment, rawSegments, shellWords } from "./shell-parse.ts";

/** The package scripts that run only through the slot (CLAUDE.md). */
const HEAVY =
  /^(test|coverage|fast-coverage|e2e|demo:shots|smoke(:[\w-]+)?|build:(daemon|desktop))$/;

/**
 * Why a heavy run (the full suite, e2e, the prints, the smokes, the builds) is blocked outside
 * `bun run slot --` (CLAUDE.md: two at once make the timing tests flaky). `env` is the hook's own
 * environment: under a slot holder (`FLIGHTDECK_SLOT_HOLDER`) the run is already in the slot.
 */
export function slotViolation(
  command: string,
  env: Record<string, string | undefined>,
): string | null {
  if (env.FLIGHTDECK_SLOT_HOLDER) return null;
  for (const segment of commandWords(command).split(/[;&|\n]+/)) {
    const words = segment.trim().split(/\s+/);
    const i = words.indexOf("bun");
    if (i < 0) continue;
    const run = words[i + 1] === "run" ? words[i + 2] : undefined;
    if (run === "slot") continue;
    // `bun test` with no file is the whole suite.
    const wholeSuite =
      words[i + 1] === "test" && words.slice(i + 2).every((w) => w.startsWith("-"));
    if (!wholeSuite && !(run && HEAVY.test(run))) continue;
    const heavy = words.slice(i).join(" ");
    return `${heavy} is heavy: run it through the slot, \`bun run slot -- ${heavy}\` (CLAUDE.md: two heavy runs at once make the timing tests flaky).`;
  }
  return null;
}

/** The coverage scripts by the names a command may give them: the package script or its file. */
const COVERAGE_SCRIPTS: Record<string, string> = {
  "test:related": "test:related",
  "scripts/test-related.ts": "test:related",
  "coverage:funcs": "coverage:funcs",
  "scripts/coverage-funcs.ts": "coverage:funcs",
};

/** The flags of `bun` and `bun run` that take the next word as their value. */
const BUN_VALUE_FLAGS = new Set(["--cwd", "--config", "-c", "--env-file", "--preload", "-r"]);

/**
 * The coverage script a command starts at word `i`, with its arguments: `bun [run] [flags] <name>`
 * (with bun's shorthand) or `npm run [flags] <name>`, where the name is the package script or its
 * file (#687). The name is the first word after the flags and their values, so a script file given
 * to another script (`bun run lint scripts/test-related.ts`) is no run of it.
 */
function coverageScriptAt(words: string[], i: number): { script: string; args: string[] } | null {
  const npm = words[i] === "npm" && words[i + 1] === "run";
  if (words[i] !== "bun" && !npm) return null;
  let at = npm ? i + 2 : i + 1;
  while (at < words.length && (words[at]?.startsWith("-") || (!npm && words[at] === "run"))) {
    at += BUN_VALUE_FLAGS.has(words[at] as string) ? 2 : 1;
  }
  const script = COVERAGE_SCRIPTS[(words[at] ?? "").replace(/^\.\//, "")];
  return script ? { script, args: words.slice(at + 1) } : null;
}

/**
 * Every full coverage run a command starts, through the slot or not, each with the override in
 * front of its own segment (#687: an override elsewhere in the command, or in front of another
 * heavy run, does not count). It reads the first coverage script of each segment only: a run
 * inside `bash -c`, `xargs` or `$(...)` counts once at most, or not at all when quoted.
 */
function heavyRuns(command: string): Array<{ what: string; override: string | undefined }> {
  const runs: Array<{ what: string; override: string | undefined }> = [];
  for (const segment of rawSegments(command)) {
    const words = shellWords(segment);
    const start = words.findIndex((_, i) => coverageScriptAt(words, i) !== null);
    if (start < 0) continue;
    const found = coverageScriptAt(words, start) as { script: string; args: string[] };
    const override = prefixAssignment(segment, "FLIGHTDECK_SLOT_HEAVY");
    // The script's own check reads its environment, which an assignment in the command sets, in
    // front of it or after a wrapper such as `env` or `slot --` (#687).
    if (words.slice(0, start).some((word) => /^["']?FLIGHTDECK_COORDINATOR=/.test(word))) {
      runs.push({
        what: `FLIGHTDECK_COORDINATOR set in the command (only the coordinator's own environment marks the coordinator) with ${found.script}`,
        override,
      });
      continue;
    }
    const what = heavyScript(found.script, found.args);
    if (what) runs.push({ what, override });
  }
  return runs;
}

/** How many test files every `--tests` names: Infinity for a glob or a command's output (#687). */
function testsGiven(args: string[]): number {
  const given: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg.startsWith("--tests=")) given.push(...arg.slice("--tests=".length).split(","));
    if (arg !== "--tests") continue;
    while (i + 1 < args.length && !(args[i + 1] as string).startsWith("-")) {
      given.push(args[++i] as string);
    }
  }
  // * ? [ $ or ` stand for an unknown number of files, quoted or not: the script takes no glob.
  const unbounded = given.some((a) => /[*?[$`]/.test(a));
  return unbounded ? Number.POSITIVE_INFINITY : given.filter((a) => a !== "").length;
}

/** Whether a coverage script with these arguments is a full coverage run, and how to name it. */
function heavyScript(script: string, args: string[]): string | null {
  if (script === "test:related") {
    const light = args.some((a) => a === "--fast" || a === "--tier" || a.startsWith("--tier="));
    return args.includes("--pr") || !light
      ? "a plain, --base or --pr `bun run test:related`"
      : null;
  }
  const given = testsGiven(args);
  if (given === Number.POSITIVE_INFINITY) {
    return "`bun run coverage:funcs` over a glob or a command's output after --tests";
  }
  return given > HEAVY_TESTS ? `\`bun run coverage:funcs\` over ${given} test files` : null;
}

/**
 * Why a worker session's full coverage run is refused (#674): a plain, `--base` or `--pr`
 * `test:related`, or a `coverage:funcs` over more than 20 given test files, holds the shared slot
 * for 12 to 25 minutes for what the PR's CI does anyway. The coordinator
 * (`FLIGHTDECK_COORDINATOR=1` in the hook's environment) and an override with a reason pass;
 * coverage:funcs's own limit still asks the coordinator for a reason (#725).
 */
export function heavyRunViolation(
  command: string,
  env: Record<string, string | undefined>,
): string | null {
  if (env.FLIGHTDECK_COORDINATOR) return null;
  const heavy = heavyRuns(command).find((run) => !heavyReasonGiven(run.override));
  if (!heavy) return null;
  if (heavy.override === undefined) return heavyRunMessage(heavy.what);
  return `FLIGHTDECK_SLOT_HEAVY needs a reason: give the reason as the value. ${heavyRunMessage(heavy.what)}`;
}

/** Whether a refused heavy run goes ahead on an override that gives its reason (#674). */
export function heavyRunWaived(command: string): boolean {
  const runs = heavyRuns(command);
  return runs.length > 0 && runs.every((run) => heavyReasonGiven(run.override));
}
