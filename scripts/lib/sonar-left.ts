/**
 * Issue #1477: `bun run sonar-left` lists SonarCloud's open findings on main and marks the ones
 * whose file changed on main since Sonar's last analysed commit (`STALE?`): Sonar analyses main
 * only on full runs, so its list goes stale between them. The API is public: no token.
 */

/** The answer of a GET, as much as the script reads of it. */
export interface Fetched {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface SonarLeftDeps {
  fetch(url: string): Promise<Fetched>;
  /** Runs git in the repository; never throws. */
  git(args: string[]): Promise<{ code: number; stdout: string }>;
  log(line: string): void;
}

const API = "https://sonarcloud.io/api";
const PROJECT = "jnerytech_flightdeck";
const PAGE = 500;

interface Issue {
  component: string;
  line?: number;
  severity: string;
  rule: string;
  message: string;
}

/** Controls (C0, DEL, C1) and bidi overrides: a terminal would act on them. */
const unsafe = (code: number) =>
  code < 0x20 ||
  (code >= 0x7f && code <= 0x9f) ||
  (code >= 0x202a && code <= 0x202e) ||
  (code >= 0x2066 && code <= 0x2069);

/** One printable line: no control or bidi character, whitespace runs folded (API text is data). */
export const oneLine = (text: unknown) =>
  [...String(text)]
    .map((c) => (unsafe(c.codePointAt(0) ?? 0) ? " " : c))
    .join("")
    .replace(/\s+/g, " ")
    .trim();

class Refused extends Error {}

const FAILED = "git could not say what changed it";

/** What follows a finding: nothing when its file is unchanged, else STALE? and why. */
function staleMark(by: string | null): string {
  if (by === null) return "";
  if (by === FAILED) return ` STALE? (${FAILED})`;
  return ` STALE? (changed by ${by})`;
}

async function get(deps: SonarLeftDeps, url: string): Promise<unknown> {
  let answer: Fetched;
  try {
    answer = await deps.fetch(url);
  } catch (error) {
    throw new Refused(`SonarCloud could not be reached: ${oneLine(String(error))}`);
  }
  if (!answer.ok) throw new Refused(`SonarCloud answered ${answer.status}`);
  return answer.json();
}

/** The commit of the last analysis of main. */
async function analysedCommit(deps: SonarLeftDeps): Promise<string> {
  const body = (await get(
    deps,
    `${API}/project_analyses/search?project=${PROJECT}&branch=main&ps=1`,
  )) as { analyses?: Array<{ revision?: string }> };
  const revision = body.analyses?.[0]?.revision;
  if (!revision || !/^[0-9a-f]{7,40}$/.test(revision)) {
    throw new Refused("SonarCloud has no analysed commit for main");
  }
  return revision;
}

/** Every open finding on main, page after page. */
async function openIssues(deps: SonarLeftDeps, severities: string | null): Promise<Issue[]> {
  const issues: Issue[] = [];
  for (let page = 1; ; page++) {
    const query = new URLSearchParams({
      componentKeys: PROJECT,
      branch: "main",
      statuses: "OPEN,CONFIRMED,REOPENED",
      ps: String(PAGE),
      p: String(page),
      ...(severities ? { severities } : {}),
    });
    const body = (await get(deps, `${API}/issues/search?${query}`)) as {
      issues?: Issue[];
      paging?: { pageIndex: number; pageSize: number; total: number };
    };
    const got = body.issues ?? [];
    issues.push(...got);
    const paging = body.paging;
    if (got.length === 0 || !paging || paging.pageIndex * paging.pageSize >= paging.total) break;
  }
  return issues;
}

/** The value after `flag`, or null. */
const option = (args: string[], flag: string) => {
  const at = args.indexOf(flag);
  return at === -1 ? null : (args[at + 1] ?? null);
};

/** `sonar-left [--severity CRITICAL,MAJOR] [--path <prefix>]`; the exit code. */
export async function sonarLeft(args: string[], deps: SonarLeftDeps): Promise<number> {
  const severities = option(args, "--severity");
  const prefix = option(args, "--path") ?? "";
  try {
    const analysed = await analysedCommit(deps);
    // The analysed commit must be here, or every file would read as changed.
    const known = await deps.git(["cat-file", "-e", `${analysed}^{commit}`]);
    if (known.code !== 0) {
      throw new Refused(
        `the analysed commit ${analysed.slice(0, 9)} is not in this clone: git fetch origin main`,
      );
    }
    // The range ends at the local origin/main: without it every finding would read as fresh.
    const tip = await deps.git(["rev-parse", "--verify", "--quiet", "origin/main^{commit}"]);
    if (tip.code !== 0) throw new Refused("this clone has no origin/main: git fetch origin main");
    const issues = (await openIssues(deps, severities))
      .map((i) => ({ ...i, file: i.component.replace(`${PROJECT}:`, "") }))
      .filter((i) => i.file.startsWith(prefix));
    deps.log(
      oneLine(
        `${issues.length} open findings, analysed ${analysed.slice(0, 9)}; origin/main ${tip.stdout.trim().slice(0, 9)} (local: git fetch origin main to read the latest); STALE? = changed on main since`,
      ),
    );
    const changedBy = new Map<string, string | null>();
    for (const file of new Set(issues.map((i) => i.file))) {
      // The commit that changed the file, not the merge that brought it in; a merge only when
      // the change is the merge's own.
      const since = (merges: string[]) =>
        deps.git([
          "log",
          "-1",
          ...merges,
          "--format=%h %s",
          "--abbrev=9",
          `${analysed}..origin/main`,
          "--",
          file,
        ]);
      const plain = await since(["--no-merges"]);
      const logged = plain.code === 0 && plain.stdout.trim() ? plain : await since([]);
      // A git that cannot say is a doubt, never "unchanged": the finding is marked for a look.
      if (logged.code !== 0) changedBy.set(file, FAILED);
      else changedBy.set(file, oneLine(logged.stdout) || null);
    }
    for (const i of issues) {
      const where = i.line ? `${i.file}:${i.line}` : i.file;
      const stale = staleMark(changedBy.get(i.file) ?? null);
      deps.log(oneLine(`${i.severity} ${i.rule} ${where} ${i.message}${stale}`));
    }
    return 0;
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    deps.log(`sonar-left: ${error.message}`);
    return 1;
  }
}
