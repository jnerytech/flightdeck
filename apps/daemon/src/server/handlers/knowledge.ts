/**
 * Issue #1288: the knowledge domain: the project's knowledge files, their index, status, creation
 * and the feed switch. Each command asks for a folder the host allows before it reads one.
 */
import { resolveAllowedCwd } from "../../paths.ts";
import type { Handlers } from "../dispatch.ts";

export const knowledgeHandlers = {
  "knowledge.list": async (payload, { server }) => {
    const list = server.need("knowledge");
    const path = await resolveAllowedCwd(payload.path, server.opts.allowedRoots);
    return await list(path);
  },
  "knowledge.index": async (payload, { server }) => {
    const feed = server.need("knowledgeFeed");
    const path = await resolveAllowedCwd(payload.path, server.opts.allowedRoots);
    return await feed(path);
  },
  "knowledge.setStatus": async (payload, { server }) => {
    const setStatus = server.need("knowledgeStatus");
    const { path: asked, file, status, expectedHash } = payload;
    const path = await resolveAllowedCwd(asked, server.opts.allowedRoots);
    return await setStatus(path, file, status, expectedHash);
  },
  "knowledge.create": async (payload, { server }) => {
    const create = server.need("knowledgeCreate");
    const { path: asked, kind, title, body } = payload;
    const path = await resolveAllowedCwd(asked, server.opts.allowedRoots);
    return await create(path, kind, title, body);
  },
  "knowledge.feed": async (payload, { server }) => {
    const feed = server.need("knowledgeFeedSwitch");
    const path = await resolveAllowedCwd(payload.path, server.opts.allowedRoots);
    return await feed.state(path);
  },
  "knowledge.setFeed": async (payload, { server }) => {
    const feed = server.need("knowledgeFeedSwitch");
    const path = await resolveAllowedCwd(payload.path, server.opts.allowedRoots);
    return await feed.set(path, payload.enabled);
  },
} satisfies Partial<Handlers>;
