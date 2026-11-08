/**
 * Issue #1288: the github domain: the sign-in with GitHub, starting from a GitHub project (phase 37)
 * and the board sync with an external board (phase 38).
 */
import type { Handlers } from "../dispatch.ts";

export const githubHandlers = {
  "boardsync.boards": async (_payload, { server }) => {
    return { boards: await server.need("boardsync").boards() };
  },
  "boardsync.link": async (payload, { server }) => {
    return await server.need("boardsync").link(payload);
  },
  "boardsync.unlink": (payload, { server }) => {
    server.need("boardsync").unlink(payload.projectId);
    return undefined;
  },
  "boardsync.setMap": async (payload, { server }) => {
    return await server.need("boardsync").setMap(payload.projectId, payload.columnMap);
  },
  "boardsync.setPush": async (payload, { server }) => {
    const { projectId, push, confirm } = payload;
    return await server.need("boardsync").setPush(projectId, push, confirm);
  },
  "boardsync.status": async (payload, { server }) => {
    return await server.need("boardsync").status(payload.projectId);
  },
  "boardsync.syncNow": async (payload, { server }) => {
    return await server.need("boardsync").syncNow(payload.projectId);
  },
  "boardsync.log": (payload, { server }) => {
    return { entries: server.need("boardsync").log(payload.cardId) };
  },
  "github.status": async (_payload, { server }) => {
    return await server.need("github").status();
  },
  "github.login.start": async (_payload, { server }) => {
    return await server.need("github").loginStart();
  },
  "github.login.cancel": async (_payload, { server }) => {
    await server.need("github").loginCancel();
    return undefined;
  },
  "github.logout": async (_payload, { server }) => {
    await server.need("github").logout();
    return undefined;
  },
  "github.repos": async (payload, { server }) => {
    return { repos: await server.need("github").repos(payload.query) };
  },
  "github.issues": async (payload, { server }) => {
    return { issues: await server.need("github").issues(payload.repo) };
  },
  "github.start": async (payload, { server }) => {
    return await server.need("github").start(payload);
  },
} satisfies Partial<Handlers>;
