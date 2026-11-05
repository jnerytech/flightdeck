/**
 * `bun run release vX.Y.Z` (issue #275): the steps of a release in order, the coordinator's only
 * (it pushes and tags). It is a small state machine over what `origin/main` says, so running it
 * again after the PR merged carries on:
 *
 * - main is behind the tag: a branch `release-vX` with `test(versao)` (red), `chore(versao)`
 *   (green) and, when the protocol surface baseline moves, `chore(release)`; it is pushed, a PR
 *   is opened and auto-merge turned on.
 * - main is at the version: the surface check, `pr tag vX` (which gates on main's CI) and
 *   `release:close vX --apply`.
 *
 * The logic is here; the effects (git, gh, bun, the files) come in through `ReleaseDeps`.
 */
import { PACKAGES } from "./release.ts";

export interface ReleaseResult {
  code: number;
  stdout: string;
}

export interface ReleaseDeps {
  git(args: string[]): Promise<ReleaseResult>;
  gh(args: string[]): Promise<ReleaseResult>;
  /** Runs `bun <args>` in the repository. */
  bun(args: string[]): Promise<ReleaseResult>;
  read(path: string): string;
  write(path: string, text: string): void;
  env: Record<string, string | undefined>;
  log(line: string): void;
}

const MAIN = "main";
const ISSUE = "(#275)";
const VERSAO_TEST = "apps/daemon/test/versao.test.ts";
const LOCK = "bun.lock";
const BASELINE = "packages/protocol/surface-baseline.txt";
const SURFACE = ["run", "scripts/protocol-surface.ts"];
const TAG = /^v(\d+\.\d+\.\d+)$/;

const reEscape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `package.json` with its own `"version": "<from>"` moved to `<to>`. */
export function bumpPackageJson(text: string, from: string, to: string): string {
  return text.replace(new RegExp(`^(\\s*"version": ")${reEscape(from)}(")`, "m"), `$1${to}$2`);
}

/** `bun.lock` with the version of the three workspaces moved to `<to>`; no package changes. */
export function bumpLock(text: string, from: string, to: string): string {
  const workspace = /("name": "@flightdeck\/(?:daemon|desktop|protocol)",\n\s+"version": ")/;
  return text.replace(
    new RegExp(`${workspace.source}${reEscape(from)}(")`, "g"),
    (_all, head: string, tail: string) => `${head}${to}${tail}`,
  );
}

/** The version test with the product version (and so its red message) moved to `<to>`. */
export function bumpVersaoTest(text: string, from: string, to: string): string {
  return text.replaceAll(from, to);
}

/** True when `a` is a later version than `b` (`x.y.z`, compared as numbers). */
export function newer(a: string, b: string): boolean {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((left[i] ?? 0) !== (right[i] ?? 0)) return (left[i] ?? 0) > (right[i] ?? 0);
  }
  return false;
}

/** Everything one run shares. */
interface Run {
  deps: ReleaseDeps;
  tag: string;
  version: string;
  branch: string;
}

const say = (run: Run, line: string) => run.deps.log(`release ${run.tag}: ${line}`);

/** The version each package has on origin/main. */
async function mainVersions(deps: ReleaseDeps): Promise<Record<string, string> | null> {
  const out: Record<string, string> = {};
  for (const pkg of PACKAGES) {
    const shown = await deps.git(["show", `origin/${MAIN}:${pkg}/package.json`]);
    if (shown.code !== 0) return null;
    out[pkg] = (JSON.parse(shown.stdout) as { version: string }).version;
  }
  return out;
}

async function commit(run: Run, paths: string[], message: string): Promise<boolean> {
  const { git } = run.deps;
  const added = await git(["add", "--", ...paths]);
  if (added.code === 0 && (await git(["commit", "-m", message])).code === 0) return true;
  say(run, `git refused the commit "${message}"`);
  return false;
}

/** The surface of the protocol keeps every line of its release baseline. */
async function surfaceKept(run: Run): Promise<boolean> {
  if ((await run.deps.bun(SURFACE)).code === 0) return true;
  say(run, "the protocol surface lost lines of its baseline: bun run scripts/protocol-surface.ts");
  return false;
}

/** The version test, the packages and the lockfile at `version`, the way every release did it. */
async function bump(run: Run, from: string): Promise<boolean> {
  const { deps, version } = run;
  deps.write(VERSAO_TEST, bumpVersaoTest(deps.read(VERSAO_TEST), from, version));
  const test = ["--config=bunfig.area.toml", "test", VERSAO_TEST];
  if ((await deps.bun(test)).code === 0) {
    say(run, "the version test is not red before the packages move: nothing to release");
    return false;
  }
  const red = `test(versao): the product version is ${version} (red: the packages say ${from}) ${ISSUE}`;
  if (!(await commit(run, [VERSAO_TEST], red))) return false;
  for (const pkg of PACKAGES) {
    const path = `${pkg}/package.json`;
    deps.write(path, bumpPackageJson(deps.read(path), from, version));
  }
  deps.write(LOCK, bumpLock(deps.read(LOCK), from, version));
  if ((await deps.bun(test)).code !== 0) {
    say(run, "the version test is still red after the packages moved");
    return false;
  }
  const paths = [...PACKAGES.map((pkg) => `${pkg}/package.json`), LOCK];
  const chore = `chore(versao): protocol, daemon and desktop go to ${version} ${ISSUE}`;
  return await commit(run, paths, chore);
}

/** Branch, bump, surface, push, PR and auto-merge. */
async function prepare(run: Run, from: string): Promise<number> {
  const { deps, branch } = run;
  const open = await deps.gh([
    "api",
    `repos/{owner}/{repo}/pulls?head={owner}:${branch}&state=open`,
    "--jq",
    ".[].number",
  ]);
  const waiting = open.stdout.trim().split("\n")[0];
  if (waiting) {
    say(run, `${branch} has PR #${waiting} open: run this again once it merged`);
    return 0;
  }
  if ((await deps.git(["switch", "-c", branch, `origin/${MAIN}`])).code !== 0) {
    say(run, `${branch} cannot be made from origin/${MAIN} (does it exist already?)`);
    return 1;
  }
  if (!(await bump(run, from)) || !(await surfaceKept(run))) return 1;
  await deps.bun([...SURFACE, "--write"]);
  const moved = await deps.git(["status", "--porcelain", "--", BASELINE]);
  const baseline = `chore(release): the protocol surface baseline of ${run.tag} ${ISSUE}`;
  if (moved.stdout.trim() !== "" && !(await commit(run, [BASELINE], baseline))) return 1;
  if ((await deps.git(["push", "-u", "origin", branch])).code !== 0) {
    say(run, `the push of ${branch} failed: no PR opened`);
    return 1;
  }
  const created = await deps.gh([
    "api",
    "-X",
    "POST",
    "repos/{owner}/{repo}/pulls",
    "-f",
    `title=chore(versao): ${run.tag}`,
    "-f",
    `head=${branch}`,
    "-f",
    `base=${MAIN}`,
    "-f",
    `body=The version of protocol, daemon and desktop goes from ${from} to ${run.version}, with the protocol surface baseline. Made by bun run release ${run.tag}.`,
    "--jq",
    '"\\(.number) \\(.html_url)"',
  ]);
  const number = Number(created.stdout.trim().split(" ")[0]);
  if (created.code !== 0 || !Number.isInteger(number)) {
    say(run, `GitHub refused the PR for ${branch}`);
    return 1;
  }
  if ((await deps.bun(["run", "pr", "--", "auto", String(number)])).code !== 0) {
    say(run, `PR #${number} is open but auto-merge is not on: bun run pr -- auto ${number}`);
    return 1;
  }
  say(run, `PR #${number} is open with auto-merge: run this again once it merged`);
  return 0;
}

/** Main has the version: the surface check, the tag and the close. */
async function finish(run: Run): Promise<number> {
  const { deps, tag } = run;
  if (!(await surfaceKept(run))) return 1;
  const exists = await deps.git(["rev-parse", "-q", "--verify", `refs/tags/${tag}`]);
  if (exists.code !== 0) {
    const tagged = await deps.bun(["run", "pr", "--", "tag", tag]);
    if (tagged.code !== 0) {
      say(run, `not tagged (bun run pr -- tag exited ${tagged.code})`);
      return tagged.code;
    }
  }
  const closed = await deps.bun(["run", "release:close", "--", tag, "--apply"]);
  if (closed.code !== 0)
    say(run, `the issues are not closed (release:close exited ${closed.code})`);
  else say(run, "tagged and closed");
  return closed.code;
}

export async function release(argv: string[], deps: ReleaseDeps): Promise<number> {
  const tag = argv.find((arg) => arg !== "--") ?? "";
  const version = TAG.exec(tag)?.[1];
  if (!version) {
    deps.log("usage: bun run release vX.Y.Z");
    return 2;
  }
  const run: Run = { deps, tag, version, branch: `release-${tag}` };
  if (deps.env.FLIGHTDECK_COORDINATOR !== "1") {
    say(run, "a release pushes and tags: it is the coordinator's (FLIGHTDECK_COORDINATOR=1)");
    return 2;
  }
  if ((await deps.git(["status", "--porcelain"])).stdout.trim() !== "") {
    say(run, "the working tree is not clean: commit or move the changes first");
    return 2;
  }
  await deps.git(["fetch", "origin", MAIN]);
  const versions = await mainVersions(deps);
  if (!versions) {
    say(run, `the packages' versions on origin/${MAIN} cannot be read`);
    return 1;
  }
  const current = Object.values(versions)[0] ?? "";
  const apart = Object.entries(versions).find(([, v]) => v !== current);
  if (apart) {
    say(run, `${apart[0]} is at ${apart[1]} on origin/${MAIN}, the others at ${current}`);
    return 2;
  }
  if (current === version) return await finish(run);
  if (!newer(version, current)) {
    say(run, `${version} is not newer than ${current}, the version on origin/${MAIN}`);
    return 2;
  }
  return await prepare(run, current);
}
