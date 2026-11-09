/**
 * Issue #248, #1288: the worktree domain: the git worktrees of a project, and removing them.
 */
import type { Handlers } from "../dispatch.ts";

export const worktreesHandlers = {
  "worktree.list": async (payload, { server }) => {
    return await server.need("worktrees").list(payload.projectId);
  },
  "worktree.remove": async (payload, { server }) => {
    return await server.need("worktrees").remove(payload.items);
  },
} satisfies Partial<Handlers>;
