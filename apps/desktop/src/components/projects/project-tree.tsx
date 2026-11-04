import { type StateTone, StatusDot } from "@/components/status/status-dot";
import { cn } from "@/lib/utils";
import type { Key, T } from "../../i18n/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import type { TreeNode, TreeProject, WorktreeFilter } from "../../lib/project-tree.ts";
import type { Route } from "../../lib/router.ts";

const TONE_KEY: Record<StateTone, string> = {
  running: "running",
  "needs-you": "needs_you",
  idle: "idle",
  ended: "ended",
  error: "idle",
};

const same = (a: WorktreeFilter | null, b: WorktreeFilter) =>
  a !== null && a.hostId === b.hostId && a.projectId === b.projectId && a.path === b.path;

/**
 * The projects of the online hosts with their checkouts: the main one (with its badge) and one
 * per card with a worktree, each with its state dot, branch and the branch it was cut from.
 * Picking one narrows the board and the Sessions list to it and opens the project's board.
 */
export function ProjectTree(props: {
  store: AppStore;
  tree: TreeProject[];
  filter: WorktreeFilter | null;
  t: T;
  go(route: Route): void;
}) {
  const { t, filter } = props;
  const pick = (project: TreeProject, node: TreeNode) => {
    const next: WorktreeFilter = {
      hostId: project.hostId,
      projectId: project.projectId,
      kind: node.kind,
      path: node.path,
      branch: node.branch,
    };
    if (same(filter, next)) return props.store.setWorktreeFilter(null);
    props.store.setWorktreeFilter(next);
    props.go({ name: "board", host: project.hostId, projectId: project.projectId });
  };
  return (
    <div data-slot="project-tree" className="project-tree">
      {props.tree.map((project) => (
        <div key={`${project.hostId}/${project.projectId}`} className="project-tree-project">
          <p className="project-tree-name">{project.name}</p>
          <ul aria-label={t("projectTree.list", { name: project.name })}>
            {project.nodes.map((node) => {
              const current = same(filter, {
                hostId: project.hostId,
                projectId: project.projectId,
                kind: node.kind,
                path: node.path,
                branch: node.branch,
              });
              return (
                <li key={node.key}>
                  <button
                    type="button"
                    aria-label={t("projectTree.node", {
                      project: project.name,
                      branch: node.branch,
                    })}
                    aria-current={current ? "true" : undefined}
                    className={cn("project-tree-node", current && "nav-active bg-sidebar-accent")}
                    onClick={() => pick(project, node)}
                  >
                    <StatusDot
                      tone={node.tone}
                      label={t(`hub.stateDots.${TONE_KEY[node.tone]}` as Key)}
                    />
                    <span className="project-tree-branch">{node.branch}</span>
                    {node.kind === "primary" && (
                      <span className="project-tree-badge">{t("projectTree.primary")}</span>
                    )}
                    <span className="project-tree-base">
                      {t("projectTree.base", { name: node.base })}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
