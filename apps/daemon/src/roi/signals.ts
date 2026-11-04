export type IssuesResult =
  | { count: number }
  | { error: "gh_missing" | "gh_logged_out" | "gh_failed" };

export interface RoiSignalsOptions {
  now?: () => number;
}

export class RoiSignals {
  constructor(private readonly _opts: RoiSignalsOptions = {}) {}

  async agentCommits(_cwd: string, _from: string, _to: string): Promise<number> {
    return -1;
  }

  async issuesClosed(_cwd: string, _from: string, _to: string): Promise<IssuesResult> {
    return { error: "gh_failed" };
  }
}
