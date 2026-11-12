/**
 * `bun run scripts/release-highlights.ts [--since <tag>]` (issue #1334): a draft of a release's
 * Highlights from the PRs merged into main since the last tag, for the coordinator to edit. It
 * keeps the PRs with a user-facing commit (feat or fix, not a Sonar or CI scope), groups them by
 * their issue, and prints one bullet per issue under a heading by area. It only reads, with gh.
 */
import type { GhResult } from "../ci-branch.ts";

export const REPO = "jnerytech/flightdeck";

/** The headings of the draft, in order; an issue no keyword places goes to Other. */
export const AREAS = [
  "Board",
  "Workflows",
  "Sessions",
  "Costs",
  "Backup",
  "Hosts",
  "Quality",
  "Other",
] as const;
export type Area = (typeof AREAS)[number];

/** A PR merged into main, as the search returns it. */
export interface MergedPr {
  number: number;
  title: string;
  mergedAt: string;
  headRefName: string;
  /** The issues it closes (GitHub's closing references). */
  closes: number[];
  commits: { headline: string; body: string }[];
}

export interface HighlightsDeps {
  gh: (args: string[]) => Promise<GhResult>;
  /** The draft (stdout). */
  log: (line: string) => void;
  /** Errors and warnings (stderr), so `> notes.md` keeps only the draft. */
  warn: (line: string) => void;
}

/** A conventional commit's `type(scope):`; "Card:" in an issue title is not one. */
const CONVENTIONAL =
  /^(feat|fix|test|refactor|chore|docs|perf|style|build|ci|revert)(?:\(([^)]*)\))?!?:\s*/;
/** Scopes that never reach a person: Sonar findings, the CI, and the BDD and e2e tests. */
const INTERNAL_SCOPE = /^(sonar|ci\b|bdd\b|e2e\b)/;
/** An issue a headline or a title names: `(#N)`. */
const HEADLINE_REF = /\(#(\d{1,9})\)/g;
/** An issue a message body names: a `Refs #N` line. */
const REFS_LINE = /^Refs:?\s*#(\d{1,9})\b/gm;
const ISO_DATE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/;
const VERSION_TAG = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;

/** The feat and fix commits of a PR whose scope a person would see. */
function userCommits(pr: MergedPr): MergedPr["commits"] {
  return pr.commits.filter((c) => {
    const m = CONVENTIONAL.exec(c.headline);
    return m !== null && (m[1] === "feat" || m[1] === "fix") && !INTERNAL_SCOPE.test(m[2] ?? "");
  });
}

/** Whether a PR carries a user-facing change: a feat or fix commit outside Sonar and CI. */
export function userFacing(pr: MergedPr): boolean {
  return !pr.headRefName.startsWith("release-v") && userCommits(pr).length > 0;
}

/** The issues a pattern finds in a text, in order. */
const found = (text: string, re: RegExp): number[] =>
  [...text.matchAll(re)].map((m) => Number(m[1]));

/**
 * The issues a commit names: the `(#N)` of its headline, with the tail GitHub moves to the body's
 * first line when it cuts the headline with "…", and its `Refs #N` lines. A `(#N)` in the body's
 * prose is not one.
 */
function commitRefs(c: { headline: string; body: string }): number[] {
  const tail = c.headline.endsWith("…") ? (c.body.split("\n")[0] ?? "") : "";
  return [...found(`${c.headline}${tail}`, HEADLINE_REF), ...found(c.body, REFS_LINE)];
}

/**
 * The issue a PR belongs to: the one it closes, else the one its feat and fix commits name most,
 * else the one its title names.
 */
export function issueOf(pr: MergedPr): number | null {
  if (pr.closes[0] !== undefined) return pr.closes[0];
  const counts = new Map<number, number>();
  for (const c of userCommits(pr)) {
    for (const n of commitRefs(c)) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  let best: number | null = null;
  for (const [n, count] of counts) if (best === null || count > (counts.get(best) ?? 0)) best = n;
  return best ?? found(pr.title, HEADLINE_REF)[0] ?? null;
}

/** The first area whose words match; the strong Quality words go first, so a demo card is Quality. */
const AREA_WORDS: [Area, RegExp][] = [
  ["Quality", /sonar|flak|\be2e\b|^(demo|lint|harness|ci)\b|\bbdd\b|coverage/],
  ["Backup", /backup|restore/],
  ["Costs", /\bcosts?\b|budget|quota|\busage\b|\bspend/],
  ["Workflows", /workflow|\bgate\b|\bruns?\b/],
  [
    "Hosts",
    /\bhosts?\b|\bpairing\b|\bdaemon\b|\bservices?\b|\bboot\b|teleport|\bssh\b|tailscale|\bsetup\b/,
  ],
  ["Board", /\bboard\b|\bcards?\b|\bcolumns?\b|\bpr\b/],
  [
    "Sessions",
    /\bsessions?\b|\bteams?\b|\bchat\b|transcript|needs you|sidebar|terminal|\bforks?\b|\bpersonas?\b/,
  ],
  ["Quality", /\btests?\b|\blint\b|journey|\btdd\b|\bhooks?\b|harness/],
];

/** The heading a text (an issue's title, or its commits' scopes) goes under. */
export function areaOf(text: string): Area {
  const words = text.toLowerCase();
  return AREA_WORDS.find(([, re]) => re.test(words))?.[0] ?? "Other";
}

interface Entry {
  title: string;
  prs: number[];
  issue: number | null;
  scopes: string[];
}

/**
 * The text without a trailing ` (#N)` and the spaces before it. The suffix is found first, so a long
 * run of spaces costs one pass, not one per space (a `\s*` before it would backtrack).
 */
function withoutIssueSuffix(text: string): string {
  const suffix = /\(#\d+\)$/.exec(text);
  return suffix ? text.slice(0, suffix.index).trimEnd() : text;
}

/** The Markdown draft: one bullet per issue, with its PRs, under its area. */
export function highlightsDraft(
  since: string,
  prs: MergedPr[],
  titles: ReadonlyMap<number, string>,
): string {
  const kept = prs.filter(userFacing);
  const entries = new Map<string, Entry>();
  for (const pr of kept) {
    const issue = issueOf(pr);
    const key = issue === null ? `pr${pr.number}` : `issue${issue}`;
    // A fetched title can be a PR's (`feat(x): …`): both lose that prefix and a trailing (#N).
    const raw = (issue === null ? undefined : titles.get(issue)) ?? pr.title;
    const title = withoutIssueSuffix(raw.replace(CONVENTIONAL, ""));
    const entry = entries.get(key) ?? { title, prs: [], issue, scopes: [] };
    entry.prs.push(pr.number);
    for (const c of userCommits(pr)) entry.scopes.push(CONVENTIONAL.exec(c.headline)?.[2] ?? "");
    entries.set(key, entry);
  }
  const lines = [
    "## Highlights (draft)",
    "",
    `Since ${since}: ${prs.length} merged PRs, ${kept.length} user-facing in ${entries.size} entries. Edit before publishing.`,
  ];
  for (const area of AREAS) {
    const bullets = [...entries.values()]
      // The title says what the change is; the scopes decide only when it says nothing.
      .filter((e) => {
        const byTitle = areaOf(e.title);
        return (byTitle === "Other" ? areaOf(e.scopes.join(" ")) : byTitle) === area;
      })
      .map((e) => {
        const refs = [...e.prs].sort((a, b) => a - b).map((n) => `#${n}`);
        if (e.issue !== null) refs.push(`#${e.issue}`);
        return `- ${e.title} (${refs.join(", ")})`;
      });
    if (bullets.length > 0) lines.push("", `**${area}**`, ...bullets);
  }
  return lines.join("\n");
}

const SEARCH = `query($q:String!,$after:String){search(query:$q,type:ISSUE,first:50,after:$after){pageInfo{hasNextPage endCursor} nodes{... on PullRequest{number title mergedAt headRefName closingIssuesReferences(first:10){nodes{number}} commits(first:100){nodes{commit{messageHeadline messageBody}}}}}}}`;

interface SearchNode {
  number: number;
  title: string;
  mergedAt: string;
  headRefName: string;
  closingIssuesReferences: { nodes: { number: number }[] };
  commits: { nodes: { commit: { messageHeadline: string; messageBody: string } }[] };
}

/** A text's first line, cut at 200 characters (an HTML page is one long line). */
const firstLine = (text: string) => (text.trim().split("\n")[0] ?? "").slice(0, 200);
/** What gh said when it failed, on one line. */
const said = (r: GhResult) => firstLine(r.stderr || r.stdout);

class Unread extends Error {}

async function read(deps: HighlightsDeps, args: string[], what: string): Promise<string> {
  const r = await deps.gh(args);
  if (r.code !== 0) throw new Unread(`could not read ${what}: ${said(r)}`);
  return r.stdout;
}

/** The JSON GitHub answered, or null when it is not JSON. */
function json(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

interface SearchPage {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: SearchNode[];
}

/** One page of the search, or why it cannot be read. */
function searchPage(text: string): SearchPage {
  const search = (json(text) as { data?: { search?: SearchPage } } | null)?.data?.search;
  if (!search || !Array.isArray(search.nodes) || !search.pageInfo) {
    throw new Unread(`could not read the merged PRs: ${firstLine(text)}`);
  }
  if (!search.nodes.every(isPr))
    throw new Unread("could not read the merged PRs: a result is not a PR");
  return search;
}

/** A search node with the fields the draft reads; a hit that is not a PR has none of them. */
function isPr(n: SearchNode | null): n is SearchNode {
  return (
    typeof n?.number === "number" &&
    typeof n.title === "string" &&
    typeof n.mergedAt === "string" &&
    typeof n.headRefName === "string" &&
    Array.isArray(n.closingIssuesReferences?.nodes) &&
    Array.isArray(n.commits?.nodes) &&
    n.commits.nodes.every(
      (c) =>
        typeof c?.commit?.messageHeadline === "string" && typeof c.commit.messageBody === "string",
    )
  );
}

/** The PRs merged into main after `date`, page by page (at most 20 pages of 50). */
async function mergedAfter(date: string, deps: HighlightsDeps): Promise<MergedPr[]> {
  const prs: MergedPr[] = [];
  let after: string | null = null;
  for (let page = 0; page < 20; page++) {
    const args = [
      "api",
      "graphql",
      "-f",
      `q=repo:${REPO} is:pr is:merged base:main merged:>=${date}`,
    ];
    if (after) args.push("-f", `after=${after}`);
    args.push("-f", `query=${SEARCH}`);
    const search = searchPage(await read(deps, args, "the merged PRs"));
    for (const n of search.nodes) {
      // The search's date is inclusive: what merged at the tag's own moment is in the tag.
      if (Date.parse(n.mergedAt) <= Date.parse(date)) continue;
      prs.push({
        number: n.number,
        title: n.title,
        mergedAt: n.mergedAt,
        headRefName: n.headRefName,
        closes: n.closingIssuesReferences.nodes.map((c) => c.number),
        commits: n.commits.nodes.map((c) => ({
          headline: c.commit.messageHeadline,
          body: c.commit.messageBody,
        })),
      });
    }
    after = search.pageInfo.hasNextPage ? search.pageInfo.endCursor : null;
    if (!after) return prs;
  }
  deps.warn("release-highlights: stopped at 1000 PRs; the draft leaves out the oldest ones");
  return prs;
}

/**
 * The titles of these issues, in one query (a number can be a PR's). A number GitHub does not find fails only itself: gh exits 1 but still prints the others.
 * When nothing can be read, the bullets keep their PRs' titles.
 */
async function titlesOf(issues: number[], deps: HighlightsDeps): Promise<Map<number, string>> {
  const titles = new Map<number, string>();
  if (issues.length === 0) return titles;
  const fields = issues
    .map(
      (n) => `i${n}:issueOrPullRequest(number:${n}){... on Issue{title} ... on PullRequest{title}}`,
    )
    .join(" ");
  const query = `{repository(owner:"${REPO.split("/")[0]}",name:"${REPO.split("/")[1]}"){${fields}}}`;
  const answer = await deps.gh(["api", "graphql", "-f", `query=${query}`]);
  const repository = (
    json(answer.stdout) as { data?: { repository?: Record<string, { title?: unknown } | null> } }
  )?.data?.repository;
  if (!repository) {
    deps.warn(
      `release-highlights: could not read the issue titles: ${said(answer)}; the bullets use the PR titles`,
    );
    return titles;
  }
  for (const n of issues) {
    const title = repository[`i${n}`]?.title;
    if (typeof title === "string" && title) titles.set(n, title);
  }
  const missing = issues.filter((n) => !titles.has(n));
  if (missing.length > 0) {
    const which = missing.map((n) => `#${n}`).join(", ");
    deps.warn(`release-highlights: GitHub did not find ${which}; its bullet uses the PR title`);
  }
  return titles;
}

/** Prints the draft; 0 when it did, 1 when GitHub could not be read, 2 for a bad argument. */
export async function releaseHighlights(args: string[], deps: HighlightsDeps): Promise<number> {
  const at = args.indexOf("--since");
  let since = at >= 0 ? (args[at + 1] ?? "") : null;
  if (since !== null && !VERSION_TAG.test(since)) {
    deps.warn("release-highlights: --since takes a version tag such as v0.37.16");
    return 2;
  }
  try {
    since ??= (
      await read(
        deps,
        ["release", "view", "-R", REPO, "--json", "tagName", "-q", ".tagName"],
        "the last release",
      )
    ).trim();
    if (!VERSION_TAG.test(since))
      throw new Unread(`could not read the last release: "${since}" is not a tag`);
    // The cutoff is the tagged commit's date: a release tags the merge commit of its own PR on main.
    const date = (
      await read(
        deps,
        ["api", `repos/${REPO}/commits/${since}`, "--jq", ".commit.committer.date"],
        `the date of ${since}`,
      )
    ).trim();
    if (!ISO_DATE.test(date)) throw new Unread(`could not read the date of ${since}: "${date}"`);
    const prs = await mergedAfter(date, deps);
    const issues = [...new Set(prs.filter(userFacing).map(issueOf))].filter(
      (n): n is number => n !== null,
    );
    deps.log(highlightsDraft(since, prs, await titlesOf(issues, deps)));
    return 0;
  } catch (error) {
    // Only what GitHub answered is reported here; a bug in the draft code throws as it is.
    if (!(error instanceof Unread)) throw error;
    deps.warn(`release-highlights: ${error.message}`);
    return 1;
  }
}
