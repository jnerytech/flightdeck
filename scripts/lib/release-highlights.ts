/**
 * `bun run scripts/release-highlights.ts [--since <tag>]` (issue #1334): a draft of a release's
 * Highlights from the PRs merged into main since the last tag, for the coordinator to edit. It
 * keeps the PRs with a user-facing commit (feat or fix, not a Sonar or CI scope), groups them by
 * their issue, and prints one bullet per issue under a heading by area. It only reads, with gh.
 */
import type { GhResult } from "./ci-branch.ts";

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
  log: (line: string) => void;
}

const CONVENTIONAL = /^(\w+)(?:\(([^)]*)\))?!?:\s*/;
/** Scopes that never reach a person: Sonar findings, the CI, and the BDD and e2e tests. */
const INTERNAL_SCOPE = /^(sonar|ci\b|bdd\b|e2e\b)/;
/** An issue a text names: `(#N)` or a `Refs #N` line. */
const NAMED = /\(#(\d{1,9})\)|^Refs:?\s*#(\d{1,9})\b/gm;
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

/** The issues a text names, in order. */
const namedIn = (text: string): number[] =>
  [...text.matchAll(NAMED)].map((m) => Number(m[1] ?? m[2]));

/**
 * The issue a PR belongs to: the one it closes, else the one its feat and fix commits name most,
 * else the one its title names. A headline GitHub cut with "…" goes on in the body, so both count.
 */
export function issueOf(pr: MergedPr): number | null {
  if (pr.closes[0] !== undefined) return pr.closes[0];
  const counts = new Map<number, number>();
  for (const c of userCommits(pr)) {
    for (const n of namedIn(`${c.headline}\n${c.body}`)) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  let best: number | null = null;
  for (const [n, count] of counts) if (best === null || count > (counts.get(best) ?? 0)) best = n;
  return best ?? namedIn(pr.title)[0] ?? null;
}

/** The first area whose words match; the strong Quality words go first, so a demo card is Quality. */
const AREA_WORDS: [Area, RegExp][] = [
  ["Quality", /sonar|flak|\be2e\b|^(demo|lint|harness|ci)\b|\bbdd\b|coverage/],
  ["Backup", /backup|restore/],
  ["Costs", /\bcosts?\b|budget|quota|usage|spend/],
  ["Workflows", /workflow|\bgate\b|\bruns?\b/],
  ["Hosts", /\bhosts?\b|pairing|daemon|service|boot|teleport|ssh|tailscale|setup/],
  ["Board", /board|\bcards?\b|column|\bpr\b/],
  ["Sessions", /session|\bteams?\b|chat|transcript|needs you|sidebar|terminal|fork|persona/],
  ["Quality", /\btests?\b|lint|journey|tdd|hook|harness/],
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
    const title =
      (issue === null ? undefined : titles.get(issue)) ??
      pr.title.replace(CONVENTIONAL, "").replace(/\s*\(#\d+\)$/, "");
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

/** What gh said when it failed, on one line. */
const said = (r: GhResult) => (r.stderr || r.stdout).trim().split("\n")[0] ?? "";

class Unread extends Error {}

async function read(deps: HighlightsDeps, args: string[], what: string): Promise<string> {
  const r = await deps.gh(args);
  if (r.code !== 0) throw new Unread(`could not read ${what}: ${said(r)}`);
  return r.stdout;
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
    const text = await read(deps, args, "the merged PRs");
    const search = JSON.parse(text).data.search as {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: SearchNode[];
    };
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
  deps.log("release-highlights: stopped at 1000 PRs; the draft leaves out the oldest ones");
  return prs;
}

/** The titles of these issues, in one query. */
async function titlesOf(issues: number[], deps: HighlightsDeps): Promise<Map<number, string>> {
  const titles = new Map<number, string>();
  if (issues.length === 0) return titles;
  const fields = issues
    .map(
      (n) => `i${n}:issueOrPullRequest(number:${n}){... on Issue{title} ... on PullRequest{title}}`,
    )
    .join(" ");
  const query = `{repository(owner:"${REPO.split("/")[0]}",name:"${REPO.split("/")[1]}"){${fields}}}`;
  const text = await read(deps, ["api", "graphql", "-f", `query=${query}`], "the issue titles");
  const repository = (JSON.parse(text).data?.repository ?? {}) as Record<
    string,
    { title?: string } | null
  >;
  for (const n of issues) {
    const title = repository[`i${n}`]?.title;
    if (title) titles.set(n, title);
  }
  return titles;
}

/** Prints the draft; 0 when it did, 1 when GitHub could not be read, 2 for a bad argument. */
export async function releaseHighlights(args: string[], deps: HighlightsDeps): Promise<number> {
  const at = args.indexOf("--since");
  let since = at >= 0 ? (args[at + 1] ?? "") : null;
  if (since !== null && !VERSION_TAG.test(since)) {
    deps.log("release-highlights: --since takes a version tag such as v0.37.16");
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
    if (!(error instanceof Unread || error instanceof SyntaxError || error instanceof TypeError))
      throw error;
    const why =
      error instanceof Unread
        ? error.message
        : `GitHub's answer could not be read: ${error.message}`;
    deps.log(`release-highlights: ${why}`);
    return 1;
  }
}
