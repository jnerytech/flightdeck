/**
 * Issue #248: the agents domain: personas, plugins, MCP servers, project memory, agent files, and
 * snippets.
 */
import { FlightdeckError, resolveAllowedCwd } from "../../kernel/index.ts";
import { requireVaultTransport } from "../../vault/index.ts";
import type { Handlers } from "../domain/handler.ts";

export const agentsHandlers = {
  "mcp.list": async (payload, { server }) => {
    return {
      servers: await server.needIn("agentSetup", "mcp").list(server.projectPath(payload.projectId)),
    };
  },
  "mcp.test": async (payload, { ws, server }) => {
    const { projectId, name, confirm } = payload;
    // A confirmed test starts the server, a command from the project's `.mcp.json`: near only, as
    // confirming a resume is. The preview starts nothing and answers anywhere (#3807).
    if (confirm) requireVaultTransport(ws.data.origin, "mcp.test", server.opts.log);
    return await server
      .needIn("agentSetup", "mcp")
      .test(server.projectPath(projectId), name, confirm === true);
  },
  "mcp.save": async (payload, { server }) => {
    const path = server.projectPath(payload.projectId);
    const mcp = server.needIn("agentSetup", "mcp");
    await mcp.save(path, payload.server, payload.confirm === true);
    return { servers: await mcp.list(path) };
  },
  "mcp.remove": async (payload, { server }) => {
    const path = server.projectPath(payload.projectId);
    const mcp = server.needIn("agentSetup", "mcp");
    await mcp.remove(path, payload.name, payload.confirm === true);
    return { servers: await mcp.list(path) };
  },
  "mcp.toggle": async (payload, { server }) => {
    const { projectId, name, enabled, confirm, sessionId } = payload;
    const path = server.projectPath(projectId);
    const mcp = server.needIn("agentSetup", "mcp");
    await mcp.toggle(path, name, enabled, confirm === true);
    if (sessionId) await server.manager.toggleMcpServer(sessionId, name, enabled);
    return { servers: await mcp.list(path) };
  },
  "mcp.status": async (payload, { server }) => {
    return { servers: await server.manager.mcpStatus(payload.sessionId) };
  },
  "agentcfg.list": async (payload, { server }) => {
    const { projectId, kind } = payload;
    return {
      items: await server
        .needIn("agentSetup", "agentcfg")
        .list(server.projectPath(projectId), kind),
    };
  },
  "agentcfg.read": async (payload, { server }) => {
    const { projectId, kind, path, origin } = payload;
    return await server
      .needIn("agentSetup", "agentcfg")
      .read(server.projectPath(projectId), kind, path, origin);
  },
  "agentcfg.write": async (payload, { server }) => {
    const { projectId, confirm, ...input } = payload;
    const written = await server
      .needIn("agentSetup", "agentcfg")
      .write(server.projectPath(projectId), {
        ...input,
        confirm: confirm === true,
      });
    return written;
  },
  "plugins.list": async (_payload, { server }) => {
    return await server.needIn("agentSetup", "plugins").list();
  },
  "plugins.detail": async (payload, { server }) => {
    return await server.needIn("agentSetup", "plugins").detail(payload.plugin);
  },
  "plugins.preview": async (payload, { server }) => {
    const { plugin, dir } = payload;
    // A folder is read like any path a caller gives the daemon: inside the allowed roots (#3516).
    return await server
      .needIn("agentSetup", "plugins")
      .preview(
        dir !== undefined
          ? { dir: await resolveAllowedCwd(dir, server.opts.allowedRoots) }
          : { plugin: plugin as string },
      );
  },
  "plugins.previewUpdate": async (payload, { server }) => {
    return await server.needIn("agentSetup", "plugins").previewUpdate(payload.plugin);
  },
  "plugins.install": async (payload, { server }) => {
    const { proof: _proof, ...request } = payload;
    // A folder to install from is read like a folder to preview: inside the allowed roots (#3516).
    const source =
      request.dir !== undefined
        ? { ...request, dir: await resolveAllowedCwd(request.dir, server.opts.allowedRoots) }
        : request;
    const approvers = server.opts.approvers;
    // #3516: with a device enrolled, the person signs the whole request, and the folder in it is the folder the
    // host installs from: a link or a relative path that resolves elsewhere is refused with the folder it is.
    if (
      approvers?.needsCommandProof("plugins.install", payload) &&
      source.dir !== undefined &&
      source.dir !== payload.dir
    ) {
      throw new FlightdeckError(
        "invalid_state",
        "the folder is another one than the folder named",
        "plugin_path_differs",
        { path: source.dir },
      );
    }
    // The proof is checked once the content shown is the content the host would fetch (see `Plugins.install`).
    return await server.needIn("agentSetup", "plugins").install(source, () => {
      approvers?.requireCommandProof("plugins.install", payload, ["confirmHash"]);
    });
  },
  "plugins.update": async (payload, { server }) => {
    const { proof: _proof, ...request } = payload;
    return await server.needIn("agentSetup", "plugins").update(request, () => {
      server.opts.approvers?.requireCommandProof("plugins.update", payload, ["confirmHash"]);
    });
  },
  "plugins.uninstall": async (payload, { server }) => {
    const { confirm, ...input } = payload;
    return await server
      .needIn("agentSetup", "plugins")
      .uninstall({ ...input, confirm: confirm === true });
  },
  "plugins.pin": async (payload, { server }) => {
    return await server.needIn("agentSetup", "plugins").pin(payload.plugin, payload.pinned);
  },
  "plugins.marketplaceAdd": async (payload, { server }) => {
    const { confirm, proof: _proof, ...input } = payload;
    // The proof is checked once the request confirms (see `Plugins.marketplaceAdd`), over the request as sent (#3516).
    return await server
      .needIn("agentSetup", "plugins")
      .marketplaceAdd({ ...input, confirm: confirm === true }, () => {
        server.opts.approvers?.requireCommandProof("plugins.marketplaceAdd", payload, ["confirm"]);
      });
  },
  "plugins.marketplaceRemove": async (payload, { server }) => {
    const { confirm, ...input } = payload;
    return await server
      .needIn("agentSetup", "plugins")
      .marketplaceRemove({ ...input, confirm: confirm === true });
  },
  "plugins.marketplaceUpdate": async (payload, { server }) => {
    return await server.needIn("agentSetup", "plugins").marketplaceUpdate(payload.name);
  },
  "memory.list": async (payload, { server }) => {
    return await server.needIn("agentSetup", "memory").list(server.projectPath(payload.projectId));
  },
  "memory.read": async (payload, { server }) => {
    const { projectId, name } = payload;
    return await server.needIn("agentSetup", "memory").read(server.projectPath(projectId), name);
  },
  "memory.write": async (payload, { server }) => {
    const { projectId, confirm, ...input } = payload;
    return await server
      .needIn("agentSetup", "memory")
      .write(server.projectPath(projectId), { ...input, confirm: confirm === true });
  },
  "memory.delete": async (payload, { server }) => {
    const { projectId, confirm, ...input } = payload;
    await server
      .needIn("agentSetup", "memory")
      .remove(server.projectPath(projectId), { ...input, confirm: confirm === true });
    return { name: input.name };
  },
  "memory.budget": async (payload, { server }) => {
    return await server
      .needIn("agentSetup", "memory")
      .budget(server.projectPath(payload.projectId));
  },
  "memory.suggest": async (payload, { server }) => {
    return {
      suggestions: await server
        .needIn("agentSetup", "memory")
        .suggest(server.projectPath(payload.projectId)),
    };
  },
  "snippets.list": async (payload, { server }) => {
    return await server.needIn("snippets", "library").list(payload);
  },
  "snippets.save": async (payload, { server }) => {
    return await server.needIn("snippets", "library").save(payload);
  },
  "snippets.get": async (payload, { server }) => {
    const { id, name, projectPath } = payload;
    return id
      ? await server.needIn("snippets", "library").get(id)
      : await server.needIn("snippets", "library").find(name as string, projectPath);
  },
  "snippets.remove": async (payload, { server }) => {
    await server.needIn("snippets", "library").remove(payload.id);
  },
  "snippets.trust": async (payload, { server }) => {
    const approvers = server.opts.approvers;
    // #3647: with a device enrolled, the person signs the project and the file's hash. The folder is the one the
    // host trusts: a link or a relative path that resolves elsewhere is refused with the folder it is, and the
    // proof is checked last, once the file is the file shown, so a refused request does not spend the challenge.
    return await server
      .needIn("snippets", "library")
      .trust(payload.projectPath, payload.hash, (project) => {
        if (
          approvers?.needsCommandProof("snippets.trust", payload) &&
          project !== payload.projectPath
        ) {
          throw new FlightdeckError(
            "invalid_state",
            "the folder is another one than the folder named",
            "trust_path_differs",
            { path: project },
          );
        }
        approvers?.requireCommandProof("snippets.trust", payload, ["projectPath", "hash"]);
      });
  },
  "snippets.favorite": async (payload, { server }) => {
    return await server.needIn("snippets", "library").favorite(payload.id, payload.favorite);
  },
  "snippets.parse": (payload, { server }) => {
    return server.needIn("snippets", "library").parse(payload.text);
  },
  "snippets.importHistory": async (payload, { server }) => {
    const { limit, reveal, select } = payload;
    const importer = server.needIn("snippets", "history");
    const done = select ? await importer.import(select) : { created: [], skipped: [] };
    const preview = await importer.preview({
      ...(limit ? { limit } : {}),
      ...(reveal ? { reveal } : {}),
    });
    return { ...preview, ...done };
  },
  "personas.list": async (payload, { server }) => {
    return await server.needIn("personas", "store").list(payload);
  },
  "personas.save": async (payload, { server }) => {
    return await server.needIn("personas", "store").save(payload);
  },
  "personas.subagents": async (payload, { server }) => {
    const { projectPath, language } = payload;
    return await server.needIn("personas", "store").subagents({ projectPath, language });
  },
  "personas.publishAgent": async (payload, { server }) => {
    return await server.needIn("personas", "store").publishAgent(payload);
  },
  "personas.resolve": async (payload, { server }) => {
    const { ref, projectPath } = payload;
    const store = server.needIn("personas", "store");
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
    return server.needIn("personas", "store").reset(payload.id, { language: payload.language });
  },
  "personas.remove": async (payload, { server }) => {
    await server.needIn("personas", "store").remove(payload.scope, payload.id, payload.projectPath);
  },
  "personas.trust": async (payload, { server }) => {
    return await server
      .needIn("personas", "store")
      .trust(payload.projectPath, payload.id, payload.hash);
  },
  "snippets.render": async (payload, { server }) => {
    return await server.needIn("snippets", "use").render(payload);
  },
  "snippets.use": async (payload, { server }) => {
    return await server.needIn("snippets", "use").use(payload);
  },
} satisfies Partial<Handlers>;
