/**
 * Issue #248, #1288: the project domain: the projects a host knows, their trust, the Claude Code
 * setup (harness) and its templates, and finding or cloning repositories. The board itself
 * (`board.*`) and the allowed roots (`roots.add`) are separate.
 */
import { FlightdeckError, featureOff } from "../../errors.ts";
import type { TemplateMarkdown } from "../../harness/templates-store.ts";
import { resolveAllowedCwd, rootNames } from "../../paths.ts";
import { cloneRepo, scanRepos, spawnGit } from "../../project-find.ts";
import { trustsManyProjects } from "../../trust/trust-root.ts";
import { requireVaultTransport } from "../../vault/vault.ts";
import type { ServerContext } from "../context.ts";
import type { Handlers } from "../dispatch.ts";

/** An option that is not set on this host: refused with `feature_off` and the feature's name. */
function on<T>(value: T | undefined, feature: string): T {
  if (!value) throw featureOff(feature);
  return value;
}

/** A host template's Markdown for a harness preview or apply, read now; null without one (#75, T1b). */
async function markdownOf(
  server: ServerContext,
  template: string | undefined,
): Promise<TemplateMarkdown | null> {
  if (template === undefined) return null;
  return on(server.opts.harnessTemplates, "harnessTemplates").files(template);
}

export const projectHandlers = {
  "project.list": async (_payload, { server }) => {
    const board = server.need("board");
    return {
      projects: await Promise.all(board.listProjects().map((p) => board.forWire(p))),
      maxParallelRuns: board.maxParallelRuns,
    };
  },
  "project.add": async (payload, { server }) => {
    const board = server.need("board");
    return await board.forWire(await board.addProject(payload));
  },
  "project.update": async (payload, { server }) => {
    const { projectId, ...patch } = payload;
    const board = server.need("board");
    return await board.forWire(board.updateProject(projectId, patch));
  },
  "project.trust.state": async (payload, { server }) => {
    const trust = on(server.opts.projectTrust, "projectTrust");
    const paths = await Promise.all(
      payload.paths.map((p) => resolveAllowedCwd(p, server.opts.allowedRoots)),
    );
    await trust.refresh();
    return { items: trust.state(paths) };
  },
  "project.trust.inspect": async (payload, { ws, server }) => {
    const trust = on(server.opts.projectTrust, "projectTrust");
    // Commands and server arguments are shown whole, a secret in one included: a near connection only.
    requireVaultTransport(ws.data.origin, "project.trust.inspect", server.opts.log);
    const path = await resolveAllowedCwd(payload.path, server.opts.allowedRoots);
    return await trust.inspect(path);
  },
  "project.trust.set": async (payload, { ws, server }) => {
    const trust = on(server.opts.projectTrust, "projectTrust");
    // Trusting lets the project's own hooks and MCP servers run without a prompt: only from a near
    // connection, like roots.add and host.bypass. Revoking only lowers risk.
    if (payload.trusted)
      requireVaultTransport(ws.data.origin, "project.trust.set", server.opts.log);
    const path = await resolveAllowedCwd(payload.path, server.opts.allowedRoots);
    // A folder above a root, or a root that is not one repository, holds many projects:
    // trusting it would trust every clone inside (#592).
    if (
      payload.trusted &&
      (await trustsManyProjects(path, await rootNames(server.opts.allowedRoots)))
    ) {
      throw new FlightdeckError(
        "invalid_state",
        "trusting this folder would trust every project inside it",
        "trust_root_refused",
      );
    }
    await trust.refresh();
    return trust.set(path, payload.trusted);
  },
  "project.harness.stack": async (payload, { server }) => {
    const stack = on(server.opts.harnessStack, "harnessStack");
    const path = await resolveAllowedCwd(payload.path, server.opts.allowedRoots);
    return await stack(path);
  },
  "project.harness.preview": async (payload, { ws, server }) => {
    const preview = on(server.opts.harnessPreview, "harnessPreview");
    const { parts, template } = payload;
    // A template's files come back whole, and T1a keeps them off a far connection: near only.
    if (template !== undefined) {
      requireVaultTransport(ws.data.origin, "project.harness.preview", server.opts.log);
    }
    const path = await resolveAllowedCwd(payload.path, server.opts.allowedRoots);
    return await preview(path, parts, await markdownOf(server, template));
  },
  "project.harness.export": async (payload, { ws, server }) => {
    const templates = on(server.opts.harnessTemplates, "harnessTemplates");
    // It reads a project's instructions into a store any project of the host can use: near only.
    requireVaultTransport(ws.data.origin, "project.harness.export", server.opts.log);
    const path = await resolveAllowedCwd(payload.path, server.opts.allowedRoots);
    const { id, title } = payload;
    return await templates.export(path, id, title);
  },
  "project.harness.draft": async (payload, { ws, server }) => {
    const draft = on(server.opts.harnessDraft, "harnessDraft");
    // A model call on the plan, whose text a later apply may write: a near connection only.
    requireVaultTransport(ws.data.origin, "project.harness.draft", server.opts.log);
    const path = await resolveAllowedCwd(payload.path, server.opts.allowedRoots);
    return await draft(path);
  },
  "project.harness.commit": async (payload, { ws, server }) => {
    const commit = on(server.opts.harnessCommit, "harnessCommit");
    // A branch made in the person's repository, one push from public: near only, and confirmed.
    requireVaultTransport(ws.data.origin, "project.harness.commit", server.opts.log);
    if (payload.confirm !== true) {
      throw new FlightdeckError(
        "invalid_state",
        "committing the Claude Code setup needs confirm: true",
        "harness_confirm",
      );
    }
    const path = await resolveAllowedCwd(payload.path, server.opts.allowedRoots);
    return await commit(path, payload.digests);
  },
  "project.harness.apply": async (payload, { ws, server }) => {
    const apply = on(server.opts.harnessApply, "harnessApply");
    // A hook written here runs its command in every session of a trusted project: a near
    // connection only, like project.trust.set, and only once the person confirmed.
    requireVaultTransport(ws.data.origin, "project.harness.apply", server.opts.log);
    const { parts, digests, confirm, reformat, template } = payload;
    if (confirm !== true) {
      throw new FlightdeckError(
        "invalid_state",
        "changing the Claude Code setup needs confirm: true",
        "harness_confirm",
      );
    }
    const path = await resolveAllowedCwd(payload.path, server.opts.allowedRoots);
    // The template is read again here: apply never takes its content from the app.
    const markdown = await markdownOf(server, template);
    return await apply(path, parts, digests, {
      reformat: reformat === true,
      ...(markdown ? { template: markdown } : {}),
    });
  },
  "harness.templates.list": async (_payload, { server }) => {
    return { templates: await on(server.opts.harnessTemplates, "harnessTemplates").list() };
  },
  "harness.templates.delete": async (payload, { ws, server }) => {
    const templates = on(server.opts.harnessTemplates, "harnessTemplates");
    // It deletes files on the host: a near connection, and only once the person confirmed.
    requireVaultTransport(ws.data.origin, "harness.templates.delete", server.opts.log);
    if (payload.confirm !== true) {
      throw new FlightdeckError(
        "invalid_state",
        "deleting a template needs confirm: true",
        "harness_confirm",
      );
    }
    return await templates.remove(payload.id);
  },
  "projects.scan": async (payload, { server }) => {
    on(server.opts.findProjects, "projects.scan");
    const { depth } = payload;
    return await scanRepos(server.opts.allowedRoots, depth ? { depth } : {});
  },
  "projects.clone": async (payload, { server }) => {
    on(server.opts.findProjects, "projects.clone");
    return await cloneRepo(payload, server.opts.allowedRoots, server.opts.git ?? spawnGit);
  },
} satisfies Partial<Handlers>;
