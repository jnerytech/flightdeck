import type { Database } from "bun:sqlite";
import type { Project } from "@flightdeck/protocol";
import { must } from "../board/worktree.ts";
import { git } from "../git/index.ts";
import { FlightdeckError, refArg } from "../kernel/index.ts";
import { hashOf } from "../workflows/index.ts";
import { parseRunConfig, type RunConfig } from "./domain/run-config.ts";

/** Where a project's run environment is declared, read from the base branch only. */
export const RUN_CONFIG_PATH = ".flightdeck/run.yaml";

const missing = () =>
  new FlightdeckError(
    "invalid_state",
    `no ${RUN_CONFIG_PATH} on the base branch`,
    "run_config_missing",
  );
const invalid = (errors: string[]) =>
  new FlightdeckError("invalid_state", "the run.yaml has validation errors", "run_config_invalid", {
    errors: errors.join("; "),
  });

export interface RunConfigInfo {
  exists: boolean;
  hash: string | null;
  trusted: boolean;
  errors: string[];
  config: RunConfig | null;
}

type ProjectRef = Pick<Project, "id" | "path" | "baseBranch">;

interface RunSource {
  source: string;
  hash: string;
}

/** The run.yaml as committed on `base`, never the card's worktree (the agent could write it). */
async function runConfigSource(repo: string, base: string): Promise<RunSource | null> {
  const listed = must(
    await git(
      repo,
      "ls-tree",
      "-z",
      "--name-only",
      "--end-of-options",
      refArg(base),
      "--",
      RUN_CONFIG_PATH,
    ),
    "git ls-tree",
  );
  if (!listed.stdout.split("\0").includes(RUN_CONFIG_PATH)) return null;
  const { stdout: source } = must(
    await git(repo, "show", "--end-of-options", `${refArg(base)}:${RUN_CONFIG_PATH}`),
    "git show",
  );
  return { source, hash: hashOf(source) };
}

/** The run configuration of the projects: read from the base branch, with trust by hash. */
export class RunConfigs {
  constructor(readonly opts: { db: Database }) {}

  async info(project: ProjectRef): Promise<RunConfigInfo> {
    const found = await runConfigSource(project.path, project.baseBranch);
    if (!found) return { exists: false, hash: null, trusted: false, errors: [], config: null };
    const { config, errors } = parseRunConfig(found.source);
    return {
      exists: true,
      hash: found.hash,
      trusted: this.trusted(project.id, found.hash),
      errors,
      config,
    };
  }

  /** Trusts the file's current content; `hash` is what the user reviewed. */
  async trust(project: ProjectRef, hash: string): Promise<RunConfigInfo> {
    const found = await runConfigSource(project.path, project.baseBranch);
    if (!found) throw missing();
    if (found.hash !== hash) {
      throw new FlightdeckError(
        "invalid_state",
        "the run.yaml changed; review the commands again before trusting it",
        "run_config_changed",
      );
    }
    const { errors } = parseRunConfig(found.source);
    if (errors.length > 0) throw invalid(errors);
    this.opts.db
      .query(
        "INSERT OR IGNORE INTO trusted_run_configs (project_id, hash, trusted_at) VALUES (?, ?, ?)",
      )
      .run(project.id, hash, new Date().toISOString());
    return this.info(project);
  }

  /** The trusted, valid configuration, or an error saying what is missing. */
  async resolve(project: ProjectRef): Promise<RunConfig> {
    const info = await this.info(project);
    if (!info.exists) throw missing();
    if (!info.config) throw invalid(info.errors);
    if (!info.trusted) {
      throw new FlightdeckError(
        "invalid_state",
        "the run.yaml is not trusted; trust it on the card",
        "run_config_untrusted",
      );
    }
    return info.config;
  }

  private trusted(projectId: string, hash: string): boolean {
    return (
      this.opts.db
        .query("SELECT 1 FROM trusted_run_configs WHERE project_id = ? AND hash = ?")
        .get(projectId, hash) !== null
    );
  }
}
