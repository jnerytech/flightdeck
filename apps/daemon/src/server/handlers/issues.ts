/**
 * Issue #248, #1288: the issues domain: a project's GitHub issues, and a card made from one.
 */
import type { Handlers } from "../domain/handler.ts";

export const issuesHandlers = {
  "issues.list": async (payload, { server }) => {
    const { projectId, query } = payload;
    return await server.need("issues").listPage(projectId, query);
  },
  "issues.get": async (payload, { server }) => {
    return await server.need("issues").get(payload.projectId, payload.id);
  },
  "issues.createCard": async (payload, { server }) => {
    return await server.need("issues").createCard(payload.projectId, payload.issueRef);
  },
} satisfies Partial<Handlers>;
