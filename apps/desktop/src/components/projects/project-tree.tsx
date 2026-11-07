import { Check, ChevronDown, Pin } from "lucide-react";
import { useState } from "react";
import { type StateTone, StatusDot } from "@/components/status/status-dot";
import { cn } from "@/lib/utils";
import type { Key, T } from "../../i18n/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import type { TreeNode, TreeProject, WorktreeFilter } from "../../lib/project-tree.ts";
import type { Route } from "../../lib/router.ts";
import {
  foldedByDefault,
  liveTone,
  PROJECT_CAP,
  pickedIn,
  projectKey,
  shownProjects,
  TREE_CAP,
  visibleNodes,
} from "../../lib/tree-fold.ts";

/** The dictionary's name of a state dot's tone: an error reads as idle, as the sidebar always did. */
const toneKey = (tone: StateTone): string => {
  if (tone === "needs-you") return "needs_you";
  return tone === "error" ? "idle" : tone;
};

/** An element id for a node: letters, digits, `_` and `-` only, so a selector made from it needs no escaping. */
const idOf = (key: string, part: string) => `pt-${key.replaceAll(/[^A-Za-z0-9_-]/g, "_")}-${part}`;

const same = (a: WorktreeFilter | null, b: WorktreeFilter) =>
  a !== null && a.hostId === b.hostId && a.projectId === b.projectId && a.path === b.path;

/**
 * The projects of the online hosts with their checkouts: the main one (with its badge) and one
 * per card with a worktree, each with its state dot, branch and the branch it was cut from.
 * Picking one narrows the board and the Sessions list to it and opens the project's board.
 */
export function ProjectTree(
  props: Readonly<{
    store: AppStore;
    tree: TreeProject[];
    filter: WorktreeFilter | null;
    /** On the Sessions list a pick narrows it in place instead of opening the board. */
    stay?: boolean;
    t: T;
    go(route: Route): void;
  }>,
) {
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
  const [unfolded, setUnfolded] = useState<string[]>(() => props.store.treeOpened());
  const [pinned, setPinned] = useState<string[]>(() => props.store.treePinned());
  const [query, setQuery] = useState("");
  // The checkouts a project lists past the cap, for this run only.
  const [opened, setOpened] = useState<string[]>([]);
  const flip = (list: string[], key: string) =>
    list.includes(key) ? list.filter((other) => other !== key) : [...list, key];
  const total = props.tree.length;
  const active = filter ? `${filter.hostId}/${filter.projectId}` : null;
  const isFolded = (key: string) =>
    folded.includes(key) || (foldedByDefault(total, key, active) && !unfolded.includes(key));
  /** The person's choice wins over the default fold: it is kept for folding and for unfolding. */
  const fold = (key: string, to?: boolean) => {
    const now = isFolded(key);
    if (to !== undefined && to === now) return;
    const toFold = !now;
    const nextFolded = toFold ? [...folded, key] : folded.filter((other) => other !== key);
    let nextUnfolded = unfolded;
    if (toFold) nextUnfolded = unfolded.filter((other) => other !== key);
    else if (foldedByDefault(total, key, active)) nextUnfolded = [...unfolded, key];
    setFolded(nextFolded);
    setUnfolded(nextUnfolded);
    props.store.setTreeFolded(nextFolded);
    props.store.setTreeOpened(nextUnfolded);
  };
  const pin = (key: string) => {
    const next = flip(pinned, key);
    setPinned(next);
    props.store.setTreePinned(next);
  };
  const projects = shownProjects(props.tree, pinned, query, active);
  return (
    <div data-slot="project-tree" className="project-tree">
      {total > PROJECT_CAP && (
        <input
          type="search"
          aria-label={t("projectTree.projectFilter")}
          placeholder={t("projectTree.projectFilter")}
          className="project-tree-filter"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQuery("");
          }}
        />
      )}
      {query.trim() !== "" && projects.length === 0 && (
        <p className="project-tree-none">{t("projectTree.noMatch")}</p>
      )}
      {projects.map((project) => {
        const key = projectKey(project);
        const closed = isFolded(key);
        const live = closed ? liveTone(project) : null;
        const pickedHere = pickedIn(filter, project.hostId, project.projectId);
        const picked = (node: TreeNode) => pickedHere !== null && pickedHere.path === node.path;
        const expanded = opened.includes(key);
        const nodes = visibleNodes(project.nodes, expanded, picked);
        const rest = project.nodes.length - nodes.length;
        return (
          <div key={key} className="project-tree-project">
            <div className="project-tree-head">
              <button
                type="button"
                data-project={project.name}
                aria-expanded={!closed}
                className="project-tree-name"
                onClick={() => fold(key)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowLeft") fold(key, true);
                  else if (e.key === "ArrowRight") fold(key, false);
                }}
              >
                <ChevronDown
                  aria-hidden="true"
                  className={cn("size-3 transition-transform duration-150", closed && "-rotate-90")}
                />
                {project.name}
                {closed && pickedHere && (
                  <Check
                    role="img"
                    aria-label={t("projectTree.pickedFolded", { branch: pickedHere.branch })}
                    className="size-3"
                  />
                )}
                {live && (
                  <StatusDot tone={live} label={t(`hub.stateDots.${toneKey(live)}` as Key)} />
                )}
              </button>
              <button
                type="button"
                aria-pressed={pinned.includes(key)}
                aria-label={t(pinned.includes(key) ? "projectTree.unpin" : "projectTree.pin", {
                  name: project.name,
                })}
                className={cn("project-tree-pin", pinned.includes(key) && "project-tree-pinned")}
                onClick={() => pin(key)}
              >
                <Pin aria-hidden="true" className="size-3" />
              </button>
            </div>
            {!closed && (
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
                            ? `${idOf(node.key, "badge")} ${idOf(node.key, "base")}`
                            : idOf(node.key, "base")
                        }
                        className={cn(
                          "project-tree-node",
                          current && "nav-active bg-sidebar-accent",
                        )}
                        onClick={() => pick(project, node)}
                      >
                        <StatusDot
                          tone={node.tone}
                          label={t(`hub.stateDots.${toneKey(node.tone)}` as Key)}
                        />
                        <span className="project-tree-branch">{node.branch}</span>
                        {node.kind === "primary" && (
                          <span id={idOf(node.key, "badge")} className="project-tree-badge">
                            {t("projectTree.primary")}
                          </span>
                        )}
                        <span id={idOf(node.key, "base")} className="project-tree-base">
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
      {total > PROJECT_CAP && (
        <button
          type="button"
          className="project-tree-more"
          onClick={() => props.go({ name: "all-projects" })}
        >
          {t("projectTree.projectsAll", { n: total })}
        </button>
      )}
    </div>
  );
}
