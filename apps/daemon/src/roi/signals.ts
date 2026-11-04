/**
 * Phase 36: the two optional value signals, each asked of the host only when a project has them
 * on. Agent commits are the commits of the period that carry a `Co-Authored-By: Claude` trailer
 * (approximate: a person may add it too); issues closed come from the host's `gh`, kept for an
 * hour because each answer is a network call. Neither blocks the event loop.
 */
import { whichOnPath } from "../which.ts";

export type IssuesResult =
  | { count: number }
  | { error: "gh_missing" | "gh_logged_out" | "gh_failed" };

export interface RoiSignalsOptions {
  now?: () => number;
}

const KEEP_MS = 3_600_000;
const TRAILER = /^co-authored-by:.*claude/im;

async function run(
  cmd: string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, {
    cwd,
    env: process.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

export class RoiSignals {
  private readonly kept = new Map<string, { at: number; count: number }>();

  constructor(private readonly opts: RoiSignalsOptions = {}) {}

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  /** Commits of the period with the trailer, one per commit however many trailers it has. */
  async agentCommits(cwd: string, from: string, to: string): Promise<number> {
    const answer = await run(
      [
        whichOnPath("git") ?? "git",
        "log",
        `--since=${from}T00:00:00Z`,
        `--until=${to}T23:59:59Z`,
        "--format=%B%x00",
      ],
      cwd,
    ).catch(() => null);
    if (!answer || answer.code !== 0) return 0;
    return answer.stdout.split("\0").filter((message) => TRAILER.test(message)).length;
  }

  async issuesClosed(cwd: string, from: string, to: string): Promise<IssuesResult> {
    const key = `${cwd}\0${from}\0${to}`;
    const hit = this.kept.get(key);
    if (hit && this.now() - hit.at < KEEP_MS) return { count: hit.count };
    const gh = whichOnPath("gh");
    if (!gh) return { error: "gh_missing" };
    const answer = await run(
      [
        gh,
        "issue",
        "list",
        "--state",
        "closed",
        "--search",
        `closed:${from}..${to}`,
        "--limit",
        "100",
        "--json",
        "number",
      ],
      cwd,
    ).catch(() => null);
    if (!answer) return { error: "gh_failed" };
    if (answer.code !== 0) {
      return { error: /gh auth login/.test(answer.stderr) ? "gh_logged_out" : "gh_failed" };
    }
    try {
      const list: unknown = JSON.parse(answer.stdout);
      if (!Array.isArray(list)) return { error: "gh_failed" };
      this.kept.set(key, { at: this.now(), count: list.length });
      return { count: list.length };
    } catch {
      return { error: "gh_failed" };
    }
  }
}
