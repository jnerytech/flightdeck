import type { Config } from "../config.ts";
import type { DomainModule } from "../server/index.ts";
import { runGhIn } from "./adapters/gh.ts";
import { listAlerts } from "./alerts.ts";
import { GithubService, type GithubServiceOptions } from "./service.ts";

/** What the daemon hands the `github.*` commands (issue #1593). */
export interface GithubDeps {
  config: Pick<Config, "allowedRoots">;
  board: GithubServiceOptions["board"];
  issues: GithubServiceOptions["issues"];
  /** The session manager: the issue's session is created there. */
  manager: { create: GithubServiceOptions["startSession"] };
}

/** The `github.*` commands' options as the daemon builds them. */
export function githubOptions({
  config,
  board,
  issues,
  manager,
}: GithubDeps): GithubServiceOptions {
  return {
    roots: config.allowedRoots,
    board,
    issues,
    // A session started from an issue gets its folder, its prompt and its name, nothing more.
    startSession: ({ cwd, prompt, name }) => manager.create({ cwd, prompt, name }),
  };
}

/**
 * The `github.*` commands, wired to this daemon's board, issues and sessions, and the open alerts
 * of a folder's repository (issue #79), as the module the server takes `github` and `alerts` from.
 */
export function createGithub(deps: GithubDeps) {
  const module: DomainModule<"github" | "alerts"> = {
    server: {
      github: new GithubService(githubOptions(deps)),
      alerts: (cwd) => listAlerts(runGhIn, cwd),
    },
  };
  return { modules: [module] as const };
}
