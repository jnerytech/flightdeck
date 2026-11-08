/**
 * Phase 37: the `github.*` commands behind one object. The daemon announces the `github` feature
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
  private readonly gh: GhRunner;
  /** The `gh` runs in flight, so a stop or a test can wait for them. */
  private readonly running = new Set<Promise<unknown>>();
  private readonly github: Github;
  private readonly login: GithubLogin;

  constructor(private readonly opts: GithubServiceOptions) {
    const run = opts.gh ?? runGh;
    this.gh = (args) => {
      const started = run(args);
      const done = () => {
        this.running.delete(started);
      };
      this.running.add(started);
      started.then(done, done);
      return started;
    };
    this.github = new Github({ gh: this.gh });
    this.login = opts.login ?? new GithubLogin();
  }

  status(): Promise<GithubStatus> {
    return githubStatus(this.gh);
  }

  loginStart(): Promise<DeviceCode> {
    return this.login.start();
  }

  /** Settles when every `gh` run started so far has ended: nothing is left running behind a stop. */
  async idle(): Promise<void> {
    while (this.running.size > 0) {
      const settling = Promise.allSettled(this.running);
      await settling; // NOSONAR: a run that ended may have started another, so look again until none is left
    }
  }

  loginCancel(): Promise<void> {
    return this.login.cancel();
  }

  logout(): Promise<void> {
    return this.github.logout();
  }

  repos(query?: string): Promise<GithubRepo[]> {
    return this.github.repos(query);
  }

  issues(repo: string): Promise<Issue[]> {
    return this.github.issues(repo);
  }

  start(request: GithubStartRequest): Promise<GithubStartResult> {
    return startFromGithub(request, {
      gh: this.gh,
      git: this.opts.git ?? spawnGit,
      roots: this.opts.roots,
      board: this.opts.board,
      issues: this.opts.issues,
      startSession: (session) => this.opts.startSession(session),
    });
  }
}
