import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { type StateTone, StatusDot } from "@/components/status/status-dot";
import { cn } from "@/lib/utils";
import type { Key, T } from "../../i18n/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import type { TreeNode, TreeProject, WorktreeFilter } from "../../lib/project-tree.ts";
import type { Route } from "../../lib/router.ts";
import { pickedIn, TREE_CAP, visibleNodes } from "../../lib/tree-fold.ts";

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
  /** On the Sessions list a pick narrows it in place instead of opening the board. */
  stay?: boolean;
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
    if (props.stay) return;
    props.go({ name: "board", host: project.hostId, projectId: project.projectId });
  };
  const [folded, setFolded] = useState<string[]>(() => props.store.treeFolded());
  const [opened, setOpened] = useState<string[]>([]);
  const flip = (list: string[], key: string) =>
    list.includes(key) ? list.filter((other) => other !== key) : [...list, key];
  const fold = (key: string, to?: boolean) => {
    const isFolded = folded.includes(key);
    if (to !== undefined && to === isFolded) return;
    const next = flip(folded, key);
    setFolded(next);
    props.store.setTreeFolded(next);
  };
  return (
    <div data-slot="project-tree" className="project-tree">
      {props.tree.map((project) => {
        const key = `${project.hostId}/${project.projectId}`;
        const isFolded = folded.includes(key);
        const pickedHere = pickedIn(filter, project.hostId, project.projectId);
        const picked = (node: TreeNode) => pickedHere !== null && pickedHere.path === node.path;
        const expanded = opened.includes(key);
        const nodes = visibleNodes(project.nodes, expanded, picked);
        const rest = project.nodes.length - nodes.length;
        return (
          <div key={key} className="project-tree-project">
            <button
              type="button"
              aria-expanded={!isFolded}
              className="project-tree-name"
              onClick={() => fold(key)}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") fold(key, true);
                else if (e.key === "ArrowRight") fold(key, false);
              }}
            >
              <ChevronDown
                aria-hidden="true"
                className={cn("size-3 transition-transform duration-150", isFolded && "-rotate-90")}
              />
              {project.name}
              {isFolded && pickedHere && (
                <Check
                  role="img"
                  aria-label={t("projectTree.pickedFolded", { branch: pickedHere.branch })}
                  className="size-3"
                />
              )}
            </button>
            {!isFolded && (
              <ul aria-label={t("projectTree.list", { name: project.name })}>
                {nodes.map((node) => {
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
                        aria-describedby={
                          node.kind === "primary"
                            ? `${node.key}:badge ${node.key}:base`
                            : `${node.key}:base`
                        }
                        className={cn(
                          "project-tree-node",
                          current && "nav-active bg-sidebar-accent",
                        )}
                        onClick={() => pick(project, node)}
                      >
                        <StatusDot
                          tone={node.tone}
                          label={t(`hub.stateDots.${TONE_KEY[node.tone]}` as Key)}
                        />
                        <span className="project-tree-branch">{node.branch}</span>
                        {node.kind === "primary" && (
                          <span id={`${node.key}:badge`} className="project-tree-badge">
                            {t("projectTree.primary")}
                          </span>
                        )}
                        <span id={`${node.key}:base`} className="project-tree-base">
                          {t("projectTree.base", { name: node.base })}
                        </span>
                      </button>
                    </li>
                  );
                })}
                {(rest > 0 || expanded) && project.nodes.length > TREE_CAP && (
                  <li>
                    <button
                      type="button"
                      aria-expanded={expanded}
                      className="project-tree-more"
                      onClick={() => setOpened(flip(opened, key))}
                    >
                      {expanded ? t("projectTree.fewer") : t("projectTree.more", { n: rest })}
                    </button>
                  </li>
                )}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
