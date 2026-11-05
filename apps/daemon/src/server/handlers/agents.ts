/**
 * Issue #248: the agents domain: personas, plugins, MCP servers, project memory, agent files, and
 * snippets.
 */
import { FlightdeckError } from "../../errors.ts";
import type { Handlers } from "../dispatch.ts";

export const agentsHandlers = {
  "mcp.list": async (payload, { server }) => {
    return {
      servers: await server.need("mcp").list(server.projectPath(payload.projectId)),
    };
  },
  "mcp.test": async (payload, { server }) => {
    const { projectId, name, confirm } = payload;
    return await server.need("mcp").test(server.projectPath(projectId), name, confirm === true);
  },
  "mcp.save": async (payload, { server }) => {
    const path = server.projectPath(payload.projectId);
    await server.need("mcp").save(path, payload.server, payload.confirm === true);
    return { servers: await server.need("mcp").list(path) };
  },
  "mcp.remove": async (payload, { server }) => {
    const path = server.projectPath(payload.projectId);
    await server.need("mcp").remove(path, payload.name, payload.confirm === true);
    return { servers: await server.need("mcp").list(path) };
  },
  "mcp.toggle": async (payload, { server }) => {
    const { projectId, name, enabled, confirm, sessionId } = payload;
    const path = server.projectPath(projectId);
    await server.need("mcp").toggle(path, name, enabled, confirm === true);
    if (sessionId) await server.manager.toggleMcpServer(sessionId, name, enabled);
    return { servers: await server.need("mcp").list(path) };
  },
  "mcp.status": async (payload, { server }) => {
    return { servers: await server.manager.mcpStatus(payload.sessionId) };
  },
  "agentcfg.list": async (payload, { server }) => {
    const { projectId, kind } = payload;
    return { items: await server.need("agentcfg").list(server.projectPath(projectId), kind) };
  },
  "agentcfg.read": async (payload, { server }) => {
    const { projectId, kind, path, origin } = payload;
    return await server.need("agentcfg").read(server.projectPath(projectId), kind, path, origin);
  },
  "agentcfg.write": async (payload, { server }) => {
    const { projectId, confirm, ...input } = payload;
    const written = await server.need("agentcfg").write(server.projectPath(projectId), {
      ...input,
      confirm: confirm === true,
    });
    return written;
  },
  "plugins.list": async (_payload, { server }) => {
    return await server.need("plugins").list();
  },
  "plugins.detail": async (payload, { server }) => {
    return await server.need("plugins").detail(payload.plugin);
  },
  "plugins.preview": async (payload, { server }) => {
    const { plugin, dir } = payload;
    return await server
      .need("plugins")
      .preview(dir !== undefined ? { dir } : { plugin: plugin as string });
  },
  "plugins.previewUpdate": async (payload, { server }) => {
    return await server.need("plugins").previewUpdate(payload.plugin);
  },
  "plugins.install": async (payload, { server }) => {
    return await server.need("plugins").install(payload);
  },
  "plugins.update": async (payload, { server }) => {
    return await server.need("plugins").update(payload);
  },
  "plugins.uninstall": async (payload, { server }) => {
    const { confirm, ...input } = payload;
    return await server.need("plugins").uninstall({ ...input, confirm: confirm === true });
  },
  "plugins.pin": async (payload, { server }) => {
    return await server.need("plugins").pin(payload.plugin, payload.pinned);
  },
  "plugins.marketplaceAdd": async (payload, { server }) => {
    const { confirm, ...input } = payload;
    return await server.need("plugins").marketplaceAdd({ ...input, confirm: confirm === true });
  },
  "plugins.marketplaceRemove": async (payload, { server }) => {
    const { confirm, ...input } = payload;
    return await server.need("plugins").marketplaceRemove({ ...input, confirm: confirm === true });
  },
  "plugins.marketplaceUpdate": async (payload, { server }) => {
    return await server.need("plugins").marketplaceUpdate(payload.name);
  },
  "memory.list": async (payload, { server }) => {
    return await server.need("memory").list(server.projectPath(payload.projectId));
  },
  "memory.read": async (payload, { server }) => {
    const { projectId, name } = payload;
    return await server.need("memory").read(server.projectPath(projectId), name);
  },
  "memory.write": async (payload, { server }) => {
    const { projectId, confirm, ...input } = payload;
    return await server
      .need("memory")
      .write(server.projectPath(projectId), { ...input, confirm: confirm === true });
  },
  "memory.delete": async (payload, { server }) => {
    const { projectId, confirm, ...input } = payload;
    await server
      .need("memory")
      .remove(server.projectPath(projectId), { ...input, confirm: confirm === true });
    return { name: input.name };
  },
  "memory.budget": async (payload, { server }) => {
    return await server.need("memory").budget(server.projectPath(payload.projectId));
  },
  "memory.suggest": async (payload, { server }) => {
    return {
      suggestions: await server.need("memory").suggest(server.projectPath(payload.projectId)),
    };
  },
  "snippets.list": async (payload, { server }) => {
    return await server.need("snippets").list(payload);
  },
  "snippets.save": async (payload, { server }) => {
    return await server.need("snippets").save(payload);
  },
  "snippets.get": async (payload, { server }) => {
    const { id, name, projectPath } = payload;
    return id
      ? await server.need("snippets").get(id)
      : await server.need("snippets").find(name as string, projectPath);
  },
  "snippets.remove": async (payload, { server }) => {
    await server.need("snippets").remove(payload.id);
  },
  "snippets.trust": async (payload, { server }) => {
    return await server.need("snippets").trust(payload.projectPath, payload.hash);
  },
  "snippets.favorite": async (payload, { server }) => {
    return await server.need("snippets").favorite(payload.id, payload.favorite);
  },
  "snippets.parse": (payload, { server }) => {
    return server.need("snippets").parse(payload.text);
  },
  "snippets.importHistory": async (payload, { server }) => {
    const { limit, reveal, select } = payload;
    const importer = server.need("snippetHistory");
    const done = select ? await importer.import(select) : { created: [], skipped: [] };
    const preview = await importer.preview({
      ...(limit ? { limit } : {}),
      ...(reveal ? { reveal } : {}),
    });
    return { ...preview, ...done };
  },
  "personas.list": async (payload, { server }) => {
    return await server.need("personas").list(payload);
  },
  "personas.save": async (payload, { server }) => {
    return await server.need("personas").save(payload);
  },
  "personas.subagents": async (payload, { server }) => {
    const { projectPath, language } = payload;
    return await server.need("personas").subagents({ projectPath, language });
  },
  "personas.publishAgent": async (payload, { server }) => {
    return await server.need("personas").publishAgent(payload);
  },
  "personas.resolve": async (payload, { server }) => {
    const { ref, projectPath } = payload;
    const store = server.need("personas");
    try {
      return await store.resolve(ref, { projectPath, language: ref.language });
    } catch (error) {
      // A folder the daemon does not allow has no personas of its own: the host's and the pack's apply.
      if (projectPath && error instanceof FlightdeckError && error.code === "forbidden_cwd") {
        return await store.resolve(ref, { language: ref.language });
      }
      throw error;
    }
  },
  "personas.reset": (payload, { server }) => {
    return server.need("personas").reset(payload.id, { language: payload.language });
  },
  "personas.remove": async (payload, { server }) => {
    await server.need("personas").remove(payload.scope, payload.id, payload.projectPath);
  },
  "personas.trust": async (payload, { server }) => {
    return await server.need("personas").trust(payload.projectPath, payload.id, payload.hash);
  },
  "snippets.render": async (payload, { server }) => {
    return await server.need("snippetUse").render(payload);
  },
  "snippets.use": async (payload, { server }) => {
    return await server.need("snippetUse").use(payload);
  },
} satisfies Partial<Handlers>;
