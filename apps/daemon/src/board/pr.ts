import { FlightdeckError } from "../errors.ts";
import { whichOnPath } from "../which.ts";
import { type CommandResult, runCommand } from "./command.ts";
import type { ChecksState, PrProviderKind, PrState } from "./types.ts";

export interface PrStatus {
  state: PrState;
  checks: ChecksState | null;
}

export interface CreatePr {
  cwd: string;
  base: string;
  head: string;
  title: string;
  body: string;
}

/** A PR host reached through its CLI, which must be installed and logged in on this host. */
export interface PrProvider {
  /** Opens the PR (or reuses the one already open for `head`) and returns its URL. */
  create(opts: CreatePr): Promise<string>;
  status(opts: { cwd: string; url: string }): Promise<PrStatus>;
  /** URL of the open PR for `head`, if any. */
  url(opts: { cwd: string; head: string }): Promise<string | null>;
}

/** Runs a CLI looked up on the current PATH (so the tests' fakes win). */
async function cli(name: string, args: string[], cwd: string): Promise<CommandResult> {
  const bin = whichOnPath(name);
  if (!bin) throw new FlightdeckError("invalid_state", `${name} não encontrado no PATH`);
  return runCommand([bin, ...args], cwd);
}

/** Stdout of a CLI call that must succeed; the error names the subcommand (`gh pr view`). */
async function cliOk(name: string, args: string[], cwd: string): Promise<string> {
  const result = await cli(name, args, cwd);
  if (result.code !== 0) {
    const what = [name, ...args.slice(0, name === "az" ? 3 : 2)].join(" ");
    throw new FlightdeckError("invalid_state", `${what} falhou: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

const cliJson = async <T>(name: string, args: string[], cwd: string): Promise<T> =>
  JSON.parse(await cliOk(name, args, cwd)) as T;

/** Worst check wins: any failure fails, anything unfinished is pending; no checks, `null`. */
function summarize(results: Array<"passing" | "failing" | "pending">): ChecksState | null {
  if (results.length === 0) return null;
  if (results.includes("failing")) return "failing";
  return results.includes("pending") ? "pending" : "passing";
}

const GH_STATES: Record<string, PrState> = { OPEN: "open", MERGED: "merged", CLOSED: "closed" };
const GH_PASS = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
const GH_FAIL = new Set(["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED"]);

interface GhCheck {
  conclusion?: string | null;
  state?: string | null;
}

/** GitHub through `gh`. */
export class GithubCli implements PrProvider {
  async create(opts: CreatePr): Promise<string> {
    const existing = await this.url(opts);
    if (existing) return existing;
    const { cwd, base, head, title, body } = opts;
    const args = ["pr", "create", "--base", base, "--head", head, "--title", title, "--body", body];
    // gh prints progress lines before the URL.
    const out = await cliOk("gh", args, cwd);
    return out.trim().split(/\r?\n/).at(-1) ?? "";
  }

  async status({ cwd, url }: { cwd: string; url: string }): Promise<PrStatus> {
    const pr = await cliJson<{ state: string; statusCheckRollup?: GhCheck[] }>(
      "gh",
      ["pr", "view", url, "--json", "state,statusCheckRollup"],
      cwd,
    );
    const checks = (pr.statusCheckRollup ?? []).map((check) => {
      const result = (check.conclusion ?? check.state ?? "").toUpperCase();
      if (GH_FAIL.has(result)) return "failing" as const;
      return GH_PASS.has(result) ? ("passing" as const) : ("pending" as const);
    });
    return { state: GH_STATES[pr.state] ?? "open", checks: summarize(checks) };
  }

  async url({ cwd, head }: { cwd: string; head: string }): Promise<string | null> {
    const result = await cli("gh", ["pr", "view", head, "--json", "url"], cwd);
    if (result.code !== 0) return null;
    return (JSON.parse(result.stdout) as { url: string }).url;
  }
}

interface AzPr {
  pullRequestId: number;
  repository: { webUrl: string };
}

const AZ_STATES: Record<string, PrState> = {
  active: "open",
  completed: "merged",
  abandoned: "closed",
};
const AZ_PASS = new Set(["approved", "notApplicable"]);
const AZ_FAIL = new Set(["rejected", "broken"]);

const azUrl = (pr: AzPr) => `${pr.repository.webUrl}/pullrequest/${pr.pullRequestId}`;

/** Azure DevOps through `az repos` (organization and project detected from the remote). */
export class AzureDevOpsCli implements PrProvider {
  async create(opts: CreatePr): Promise<string> {
    const existing = await this.url(opts);
    if (existing) return existing;
    const { cwd, base, head, title, body } = opts;
    const pr = await cliJson<AzPr>(
      "az",
      [
        "repos",
        "pr",
        "create",
        "--source-branch",
        head,
        "--target-branch",
        base,
        "--title",
        title,
        "--description",
        body,
        "--output",
        "json",
      ],
      cwd,
    );
    return azUrl(pr);
  }

  async status({ cwd, url }: { cwd: string; url: string }): Promise<PrStatus> {
    const id = /\/pullrequest\/(\d+)/.exec(url)?.[1] ?? "";
    const pr = await cliJson<{ status: string }>(
      "az",
      ["repos", "pr", "show", "--id", id, "--output", "json"],
      cwd,
    );
    const policies = await cliJson<Array<{ status: string }>>(
      "az",
      ["repos", "pr", "policy", "list", "--id", id, "--output", "json"],
      cwd,
    );
    const checks = policies.map(({ status }) => {
      if (AZ_FAIL.has(status)) return "failing" as const;
      return AZ_PASS.has(status) ? ("passing" as const) : ("pending" as const);
    });
    return { state: AZ_STATES[pr.status] ?? "open", checks: summarize(checks) };
  }

  async url({ cwd, head }: { cwd: string; head: string }): Promise<string | null> {
    const prs = await cliJson<AzPr[]>(
      "az",
      ["repos", "pr", "list", "--source-branch", head, "--status", "active", "--output", "json"],
      cwd,
    );
    const [first] = prs;
    return first ? azUrl(first) : null;
  }
}

/** The provider registered for a project; `none` has none. */
export function prProvider(kind: PrProviderKind): PrProvider | null {
  if (kind === "github") return new GithubCli();
  return kind === "azure-devops" ? new AzureDevOpsCli() : null;
}
