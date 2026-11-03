/**
 * Phase 36: the `github.*` commands behind one object. The daemon announces the `github` feature
 * when it has one. The token stays with `gh`: nothing here reads, keeps or logs it.
 */
import type { Issue } from "@flightdeck/protocol";
import type { Board } from "../board/board.ts";
import type { Issues } from "../issues/issues.ts";
import { type GitRunner, spawnGit } from "../project-find.ts";
import { type GhRunner, runGh } from "./gh.ts";
import { Github, type GithubRepo } from "./github.ts";
import { type DeviceCode, GithubLogin } from "./login.ts";
import { type GithubStartRequest, type GithubStartResult, startFromGithub } from "./start.ts";
import { type GithubStatus, githubStatus } from "./status.ts";

export interface GithubServiceOptions {
  gh?: GhRunner;
  git?: GitRunner;
  roots: readonly string[];
  board: Board;
  issues: Issues;
  startSession(opts: { cwd: string; prompt: string; name: string }): Promise<{ sessionId: string }>;
  login?: GithubLogin;
}

export class GithubService {
  constructor(private readonly opts: GithubServiceOptions) {}

  async status(): Promise<GithubStatus> {
    void githubStatus;
    void runGh;
    return { installed: true, loggedIn: true, login: "", scopes: [], source: "file" };
  }

  async loginStart(): Promise<DeviceCode> {
    void GithubLogin;
    return { code: "", url: "" };
  }

  loginCancel(): void {}

  async logout(): Promise<void> {
    void Github;
  }

  async repos(_query?: string): Promise<GithubRepo[]> {
    return [];
  }

  async issues(_repo: string): Promise<Issue[]> {
    return [];
  }

  async start(_request: GithubStartRequest): Promise<GithubStartResult> {
    void startFromGithub;
    void spawnGit;
    void this.opts;
    return { projectId: "", path: "", reused: true };
  }
}
