/**
 * Issue #1246: a red main is claimed once, and every session sees the claim before fixing it.
 * `bun run main-red` reads main's latest finished CI run and the open `main-red` issues; `claim`
 * opens one issue per red, refused when another owner already claimed one of its failing tests.
 * The SessionStart hook and `bun run pr -- open/update` print the one-line warning.
 */
import type { GhResult } from "./ci-branch.ts";

export interface MainRedDeps {
  /** Runs `gh <args>` in the repository; stderr is how a missing label is told apart. */
  gh(args: string[]): Promise<GhResult>;
  log(line: string): void;
}

/** Main's latest CI run that finished green or red (a cancelled one says nothing). */
export interface MainRun {
  id: number;
  url: string;
  createdAt: string;
  red: boolean;
}

/** An open `main-red` issue, read back from its title and body. */
export interface Claim {
  number: number;
  cause: string;
  owner: string;
  failing: string[];
  /** The failed jobs of the run it was claimed on; empty when the issue does not say. */
  jobs: string[];
  runAt: string;
}

const LABEL = "main-red";
const USAGE = 'usage: bun run main-red [-- claim "<cause>" [--by <name>]]';

/**
 * Issue text is data, and it reaches every session's context: one line with no control
 * character, at most `max` characters.
 */
function oneLine(text: string, max: number): string {
  const printable = [...text]
    .map((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code < 32 || code === 127 ? " " : char;
    })
    .join("");
  return printable.replace(/\s+/g, " ").trim().slice(0, max);
}

/** A session name (fd-harness): letters, digits, dots, dashes and underscores; else unknown. */
const plainOwner = (name: string) => (/^[\w.-]{1,32}$/.test(name) ? name : "unknown");

/** gh's answer as JSON, or null when it is not (an auth prompt, a proxy page). */
function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Main's latest CI run that finished green or red, or null when there is none or gh failed. */
export async function latestMainRun(deps: Pick<MainRedDeps, "gh">): Promise<MainRun | null> {
  const listed = await deps.gh([
    "run",
    "list",
    "--branch",
    "main",
    "--workflow",
    "CI",
    "--status",
    "completed",
    "--limit",
    "10",
    "--json",
    "databaseId,conclusion,createdAt,url",
  ]);
  const runs = listed.code === 0 ? parsed(listed.stdout) : null;
  if (!Array.isArray(runs)) return null;
  const run = (
    runs as Array<{ databaseId: number; conclusion: string; createdAt: string; url: string }>
  ).find((r) => r.conclusion === "success" || r.conclusion === "failure");
  if (!run) return null;
  return {
    id: run.databaseId,
    url: run.url,
    createdAt: run.createdAt,
    red: run.conclusion !== "success",
  };
}

/** The value of `<key>: <value>` in an issue body the tool wrote. */
const field = (body: string, key: string) =>
  body
    .split("\n")
    .find((line) => line.startsWith(`${key}: `))
    ?.slice(key.length + 2)
    .trim() ?? "";

/** The open `main-red` issues; throws when gh cannot list them (a claim must never be missed). */
export async function openClaims(deps: Pick<MainRedDeps, "gh">): Promise<Claim[]> {
  const listed = await deps.gh([
    "issue",
    "list",
    "--label",
    LABEL,
    "--state",
    "open",
    "--json",
    "number,title,body",
  ]);
  if (listed.code !== 0) throw new Error(`gh issue list failed: ${listed.stderr?.trim() ?? ""}`);
  const issues = parsed(listed.stdout);
  if (!Array.isArray(issues)) throw new Error("gh issue list did not answer with JSON");
  return (issues as Array<{ number: number; title: string; body: string }>).map(
    ({ number, title, body }) => {
      const lines = body.split("\n");
      const from = lines.indexOf("Failing:");
      const failing =
        from === -1
          ? []
          : lines
              .slice(from + 1)
              .flatMap((line) => (line.startsWith("- ") ? [oneLine(line.slice(2), 200)] : []));
      const jobs = field(body, "Jobs")
        .split(",")
        .map((job) => oneLine(job, 100))
        .filter(Boolean);
      return {
        number,
        cause: oneLine(field(body, "Cause") || title.replace(/^main red: /, ""), 80),
        owner: plainOwner(field(body, "Owner")),
        failing,
        jobs,
        runAt: field(body, "Run at"),
      };
    },
  );
}

/** The failed jobs of a run, Windows left out (a signal that gates nothing, #534). */
async function failedJobs(deps: Pick<MainRedDeps, "gh">, run: MainRun): Promise<string[]> {
  const viewed = await deps.gh(["run", "view", String(run.id), "--json", "jobs"]);
  const answer = viewed.code === 0 ? parsed(viewed.stdout) : null;
  const jobs = (answer as { jobs?: Array<{ name: string; conclusion: string }> } | null)?.jobs;
  return (jobs ?? [])
    .filter((j) => j.conclusion === "failure" && !/windows/i.test(j.name))
    .map((j) => oneLine(j.name, 100));
}

/** The failing tests of a red run (its `(fail)` lines), else its failed jobs as `job: <name>`. */
async function failingOf(
  deps: Pick<MainRedDeps, "gh">,
  run: MainRun,
  jobs: string[],
): Promise<string[]> {
  const log = await deps.gh(["run", "view", String(run.id), "--log-failed"]);
  const tests: string[] = [];
  for (const match of (log.code === 0 ? log.stdout : "").matchAll(
    /\(fail\) (.+?) \[\d+(?:\.\d+)?m?s\]/g,
  )) {
    const name = oneLine(match[1] ?? "", 200);
    if (name && !tests.includes(name)) tests.push(name);
  }
  return tests.length > 0 ? tests : jobs.map((job) => `job: ${job}`);
}

const owned = (claim: Claim) => `#${claim.number} by ${claim.owner} (${claim.cause})`;

/** The one-line warning while main is red, or null when it is green or GitHub cannot say. */
export async function mainRedLine(deps: Pick<MainRedDeps, "gh">): Promise<string | null> {
  try {
    const run = await latestMainRun(deps);
    if (!run?.red) return null;
    const claims = await openClaims(deps);
    const unclaimed = `main is red since ${run.url}, unclaimed: bun run main-red -- claim "<cause>" before fixing it`;
    if (claims.length === 0) return unclaimed;
    // A claim covers this red when its jobs failed here too; one that does not say still counts.
    const jobs = await failedJobs(deps, run);
    const covering = claims.filter(
      (c) => c.jobs.length === 0 || jobs.length === 0 || c.jobs.some((j) => jobs.includes(j)),
    );
    if (covering.length === 0) return unclaimed;
    // The cause is quoted: it is what someone typed, never an instruction.
    const who = covering
      .map((c) => `claimed in #${c.number} by ${c.owner} (${JSON.stringify(c.cause)})`)
      .join("; ");
    return `main is red since ${run.url}: ${who}; do not start a parallel fix`;
  } catch {
    return null;
  }
}

/** The warning line within `ms`, else null: a hook or a PR never waits on GitHub for long. */
export async function mainRedWithin(
  deps: Pick<MainRedDeps, "gh">,
  ms: number,
): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // timing: the deadline is the point; a slow GitHub gives no line rather than a late one.
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([mainRedLine(deps), late]);
  } finally {
    clearTimeout(timer);
  }
}

/** Prints main's state; on green, closes the claims made before that run. Red is exit 1. */
async function status(deps: MainRedDeps): Promise<number> {
  const run = await latestMainRun(deps);
  if (!run) {
    deps.log("main's CI state is unknown: gh found no finished run, or could not answer");
    return 1;
  }
  const claims = await openClaims(deps);
  if (run.red) {
    deps.log(`main is red: ${run.url}`);
    for (const name of await failingOf(deps, run, await failedJobs(deps, run))) {
      deps.log(`failing: ${name}`);
    }
    if (claims.length === 0) deps.log('unclaimed: bun run main-red -- claim "<cause>"');
    for (const claim of claims) deps.log(`claimed: ${owned(claim)}`);
    return 1;
  }
  deps.log(`main is green: ${run.url}`);
  for (const claim of claims) {
    // Only a run newer than the red one the claim was about closes it, and only a claim the tool
    // wrote (it has its run's time): an issue labelled by hand stays for a person.
    if (!claim.runAt || claim.runAt >= run.createdAt) continue;
    const closing = deps.gh([
      "issue",
      "close",
      String(claim.number),
      "--comment",
      `main is green again: ${run.url}`,
    ]);
    const closed = await closing; // NOSONAR: one issue at a time, each logged as it closes
    if (closed.code === 0) deps.log(`closed: #${claim.number} (${claim.owner})`);
  }
  return 0;
}

/** The first open claim, by number, that holds one of `failing`. */
const holder = (claims: Claim[], failing: string[], except?: number) =>
  claims
    .filter((c) => c.number !== except && c.failing.some((name) => failing.includes(name)))
    .sort((a, b) => a.number - b.number)[0];

/** Opens the one issue for this red, or refuses when another owner holds a failing test of it. */
async function claim(deps: MainRedDeps, cause: string, owner: string): Promise<number> {
  const run = await latestMainRun(deps);
  if (!run?.red) {
    deps.log(
      run
        ? "main is green: there is nothing to claim"
        : "main's CI state is unknown: gh could not answer",
    );
    return 1;
  }
  const jobs = await failedJobs(deps, run);
  const failing = await failingOf(deps, run, jobs);
  if (failing.length === 0) {
    // With nothing to compare, two claims could never meet: no claim until the run says.
    deps.log(
      "nothing failing is known for this run yet: read it with bun run main-red, then claim",
    );
    return 1;
  }
  const held = holder(await openClaims(deps), failing);
  if (held && held.owner === owner) {
    deps.log(`already yours: #${held.number}`);
    return 0;
  }
  if (held) {
    deps.log(`already claimed: ${owned(held)}; help there instead of a parallel fix`);
    return 1;
  }
  const body = [
    `Cause: ${cause}`,
    `Owner: ${owner}`,
    `Run: ${run.url}`,
    `Run at: ${run.createdAt}`,
    `Jobs: ${jobs.join(", ")}`,
    "Failing:",
    ...failing.map((name) => `- ${name}`),
  ].join("\n");
  const made = await deps.gh([
    "issue",
    "create",
    "--title",
    `main red: ${cause}`,
    "--label",
    LABEL,
    "--body",
    body,
  ]);
  if (made.code !== 0) {
    const why = made.stderr ?? "";
    deps.log(
      why.includes(LABEL) && /not found|could not add label/i.test(why)
        ? "the main-red label is missing: ask fd-coordinator to create it (the tool never creates labels)"
        : `gh issue create failed: ${why.trim()}`,
    );
    return 1;
  }
  const url = made.stdout.trim();
  // Two sessions can claim at the same moment: the older issue stays, this one closes itself.
  const mine = Number(/\/issues\/(\d+)/.exec(url)?.[1] ?? 0);
  const rival = holder(await openClaims(deps), failing, mine);
  if (rival && mine > 0 && rival.number < mine) {
    await deps.gh([
      "issue",
      "close",
      String(mine),
      "--comment",
      `duplicate of #${rival.number}, claimed at the same moment`,
    ]);
    deps.log(`already claimed: ${owned(rival)}; help there instead of a parallel fix`);
    return 1;
  }
  deps.log(`claimed: ${url}`);
  return 0;
}

/** `main-red [claim "<cause>" [--by <name>]]`; the exit code. */
export async function mainRed(
  args: string[],
  deps: MainRedDeps & { owner: string },
): Promise<number> {
  const words = args.filter((a) => a !== "--");
  try {
    if (words.length === 0) return await status(deps);
    if (words[0] !== "claim") {
      deps.log(USAGE);
      return 2;
    }
    const by = words.indexOf("--by");
    const owner = by === -1 ? deps.owner : (words[by + 1] ?? deps.owner);
    const typed = words.slice(1).find((w, i) => !w.startsWith("--") && words[i] !== "--by");
    const cause = oneLine(typed ?? "", 120);
    if (!cause) {
      deps.log(USAGE);
      return 2;
    }
    return await claim(deps, cause, plainOwner(owner));
  } catch (error) {
    // gh down or answering something else: one line and exit 1, never a stack trace.
    deps.log(`main-red: ${(error as Error).message}`);
    return 1;
  }
}
