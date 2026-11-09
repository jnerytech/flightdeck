/**
 * Issue #248, #1288: the issues domain: a project's GitHub issues, and a card made from one.
 */
import type { Handlers } from "../dispatch.ts";

export const issuesHandlers = {
  "issues.list": async (payload, { server }) => {
    const { projectId, query } = payload;
    return { issues: await server.need("issues").list(projectId, query) };
  },
  "issues.get": async (payload, { server }) => {
    return await server.need("issues").get(payload.projectId, payload.id);
  },
  "issues.createCard": async (payload, { server }) => {
    return await server.need("issues").createCard(payload.projectId, payload.issueRef);
  },
} satisfies Partial<Handlers>;
