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

/** A host template's Markdown for a harness preview or apply, read now; null without one (#75, T1b). */
async function markdownOf(
  server: ServerContext,
  template: string | undefined,
): Promise<TemplateMarkdown | null> {
  if (template === undefined) return null;
  const templates = server.opts.harnessTemplates;
  if (!templates) throw featureOff("harnessTemplates");
  return templates.files(template);
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
    const trust = server.opts.projectTrust;
    if (!trust) throw featureOff("projectTrust");
    const paths = await Promise.all(
      payload.paths.map((p) => resolveAllowedCwd(p, server.opts.allowedRoots)),
    );
    await trust.refresh();
    return { items: trust.state(paths) };
  },
  "project.trust.inspect": async (payload, { ws, server }) => {
    const trust = server.opts.projectTrust;
    if (!trust) throw featureOff("projectTrust");
    // Commands and server arguments are shown whole, a secret in one included: a near connection only.
    requireVaultTransport(ws.data.origin, "project.trust.inspect", server.opts.log);
    const path = await resolveAllowedCwd(payload.path, server.opts.allowedRoots);
    return await trust.inspect(path);
  },
  "project.trust.set": async (payload, { ws, server }) => {
    const trust = server.opts.projectTrust;
    if (!trust) throw featureOff("projectTrust");
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
    const stack = server.opts.harnessStack;
    if (!stack) throw featureOff("harnessStack");
    const path = await resolveAllowedCwd(payload.path, server.opts.allowedRoots);
    return await stack(path);
  },
  "project.harness.preview": async (payload, { ws, server }) => {
    const preview = server.opts.harnessPreview;
    if (!preview) throw featureOff("harnessPreview");
    const { parts, template } = payload;
    // A template's files come back whole, and T1a keeps them off a far connection: near only.
    if (template !== undefined) {
      requireVaultTransport(ws.data.origin, "project.harness.preview", server.opts.log);
    }
    const path = await resolveAllowedCwd(payload.path, server.opts.allowedRoots);
    return await preview(path, parts, await markdownOf(server, template));
  },
  "project.harness.export": async (payload, { ws, server }) => {
    const templates = server.opts.harnessTemplates;
    if (!templates) throw featureOff("harnessTemplates");
    // It reads a project's instructions into a store any project of the host can use: near only.
    requireVaultTransport(ws.data.origin, "project.harness.export", server.opts.log);
    const path = await resolveAllowedCwd(payload.path, server.opts.allowedRoots);
    const { id, title } = payload;
    return await templates.export(path, id, title);
  },
  "project.harness.draft": async (payload, { ws, server }) => {
    const draft = server.opts.harnessDraft;
    if (!draft) throw featureOff("harnessDraft");
    // A model call on the plan, whose text a later apply may write: a near connection only.
    requireVaultTransport(ws.data.origin, "project.harness.draft", server.opts.log);
    const path = await resolveAllowedCwd(payload.path, server.opts.allowedRoots);
    return await draft(path);
  },
  "project.harness.commit": async (payload, { ws, server }) => {
    const commit = server.opts.harnessCommit;
    if (!commit) throw featureOff("harnessCommit");
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
    const apply = server.opts.harnessApply;
    if (!apply) throw featureOff("harnessApply");
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
    const templates = server.opts.harnessTemplates;
    if (!templates) throw featureOff("harnessTemplates");
    return { templates: await templates.list() };
  },
  "harness.templates.delete": async (payload, { ws, server }) => {
    const templates = server.opts.harnessTemplates;
    if (!templates) throw featureOff("harnessTemplates");
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
    if (!server.opts.findProjects) throw featureOff("projects.scan");
    const { depth } = payload;
    return await scanRepos(server.opts.allowedRoots, depth ? { depth } : {});
  },
  "projects.clone": async (payload, { server }) => {
    if (!server.opts.findProjects) throw featureOff("projects.clone");
    return await cloneRepo(payload, server.opts.allowedRoots, server.opts.git ?? spawnGit);
  },
} satisfies Partial<Handlers>;
