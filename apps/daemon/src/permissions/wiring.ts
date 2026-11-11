import type { Config } from "../config.ts";
import {
  AutoApprover,
  type AutoApproverOptions,
  type AutoApproveSettings,
} from "./auto-approve.ts";
import { RiskClassifier } from "./risk.ts";

/** The project (and card) whose folder holds a cwd, as the board finds it. */
interface CwdProject {
  project: { id: string; autoApprove: AutoApproveSettings };
  card: { id: string; description: string } | null;
}

/** What the permission domain is built from (issue #1593). */
export interface PermissionsDeps {
  db: AutoApproverOptions["db"];
  runtime: AutoApproverOptions["runtime"];
  config: Pick<Config, "allowedRoots" | "dataDir" | "risk">;
  /** The user's home, for `~` and the credential paths. */
  home: string;
  /** The board's lookup; the board is made later, so the call is bound late. */
  projectForCwd(cwd: string): CwdProject | null;
  usage: NonNullable<AutoApproverOptions["usage"]>;
}

/** The risk classifier and the projects' automatic approval. */
export function createPermissions({
  db,
  runtime,
  config,
  home,
  projectForCwd,
  usage,
}: PermissionsDeps) {
  // Phase 13: one classifier for managed and terminal sessions, with the config's extra rules.
  const risk = new RiskClassifier({
    allowedRoots: config.allowedRoots,
    home,
    extraHigh: config.risk.extraHigh,
  });
  // Phase 13: the projects' automatic approval, through the board and the costs.
  const autoApprove = new AutoApprover({
    db,
    runtime,
    dataDir: config.dataDir,
    context: (cwd) => {
      const found = projectForCwd(cwd);
      if (!found) return null;
      const { project, card } = found;
      return {
        projectId: project.id,
        settings: project.autoApprove,
        ...(card ? { description: card.description, cardId: card.id } : {}),
      };
    },
    usage,
  });
  return { risk, autoApprove };
}
