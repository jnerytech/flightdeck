/**
 * The projects' public entry in the app (#1589, #1597): add a project, the sidebar tree and its
 * flyout, the worktree chip and the project card. The Projects, Project and overview screens are
 * loaded by their own files, lazily. Another domain imports from here, never a file inside.
 */
export { AddProject } from "./add-project.tsx";
export { ProjectCardTile } from "./project-card-tile.tsx";
export { buildProjectCards, type ProjectCard } from "./project-cards.ts";
export { knownProjectKeys, ProjectKeys } from "./project-keys.ts";
export { ProjectTree } from "./project-tree.tsx";
export {
  activeWorktreeFilter,
  cardInFilter,
  projectTree,
  rowInFilter,
  type TreeNode,
  type TreeProject,
  type WorktreeFilter,
  worktreeOfProject,
} from "./project-tree-model.ts";
export { RailFlyout } from "./rail-flyout.tsx";
export { ProjectsSlice } from "./store.ts";
export { wireProjects } from "./wire.ts";
export { WorktreeChip } from "./worktree-chip.tsx";
