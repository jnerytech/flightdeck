/**
 * Phase 36: the two optional value signals, each asked of the host only when a project has them
 * on. Agent commits are the commits of the period that carry a `Co-Authored-By: Claude` trailer
 * (approximate: a person may add it too); issues closed come from the host's `gh`, kept for an
 * hour because each answer is a network call. Neither blocks the event loop.
 */

import { git } from "../git/index.ts";
import { type ClosedIssues, closedIssues } from "../github/index.ts";

export type IssuesResult = ClosedIssues;

export interface RoiSignalsOptions {
  now?: () => number;
}

const KEEP_MS = 3_600_000;
const TRAILER = /^co-authored-by:.*claude/im;

export class RoiSignals {
  private readonly kept = new Map<string, { at: number; count: number }>();

  constructor(private readonly opts: RoiSignalsOptions = {}) {}

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  /** Commits of the period with the trailer, one per commit however many trailers it has. */
  async agentCommits(cwd: string, from: string, to: string): Promise<number> {
    // git-arg: `from` and `to` are dates the ROI report built; each is the value of its own option
    const answer = await git(
      cwd,
      "log",
      `--since=${from}T00:00:00Z`,
      `--until=${to}T23:59:59Z`,
      "--format=%B%x00",
    ).catch(() => null);
    if (answer?.code !== 0) return 0;
    return answer.stdout.split("\0").filter((message) => TRAILER.test(message)).length;
  }

  async issuesClosed(cwd: string, from: string, to: string): Promise<IssuesResult> {
    const key = `${cwd}\0${from}\0${to}`;
    const hit = this.kept.get(key);
    if (hit && this.now() - hit.at < KEEP_MS) return { count: hit.count };
    const answer = await closedIssues(cwd, from, to);
    if ("count" in answer) this.kept.set(key, { at: this.now(), count: answer.count });
    return answer;
  }
}
