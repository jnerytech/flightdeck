/**
 * The projects' public entry in the app (#1589, #1597): add a project, the sidebar tree and its
 * flyout, the worktree chip and the project card. The Projects, Project and overview screens are
 * loaded by their own files, lazily. Another domain imports from here, never a file inside.
 */
export type { ProjectCard } from "./project-cards.ts";
export { knownProjectKeys, ProjectKeys } from "./project-keys.ts";
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
export { ProjectsSlice } from "./store.ts";
export { useProjectCards } from "./use-project-cards.ts";
export { wireProjects } from "./wire.ts";
