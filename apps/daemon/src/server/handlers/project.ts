/**
 * Issue #248, #1288: the project domain: the projects a host knows, their trust, the Claude Code
 * setup (harness) and its templates, and finding or cloning repositories. The board itself
 * (`board.*`) and the allowed roots (`roots.add`) are separate.
 */
import { AutoApproveSettings } from "@flightdeck/protocol";
import { DEFAULT_PROMPT_TEMPLATE } from "../../board/index.ts";
import type { TemplateMarkdown } from "../../harness/index.ts";
import { FlightdeckError, featureOff, resolveAllowedCwd, rootNames } from "../../kernel/index.ts";
import { detectProvider } from "../../pr-hosts/index.ts";
import { cloneRepo, scanRepos, spawnGit } from "../../projects/index.ts";
import { diskTrustRootFs, trustsManyProjects } from "../../trust/index.ts";
import { requireVaultTransport } from "../../vault/index.ts";
import type { ServerContext } from "../context.ts";
import type { Handlers } from "../domain/handler.ts";

/** A host template's Markdown for a harness preview or apply, read now; null without one (#75, T1b). */
async function markdownOf(
  server: ServerContext,
  template: string | undefined,
): Promise<TemplateMarkdown | null> {
  if (template === undefined) return null;
  const templates = server.needIn("harness", "templates");
  return templates.files(template);
}

/** The model the automatic approval starts with: choosing another one is near only (#3825). */
const DEFAULT_MODEL = AutoApproveSettings.parse({}).model;

/**
 * Whether a change makes the automatic approval approve more than it did: on where it was off, or
 * low risk without the AI where it was not. The CLI sends the stored values back with a change, so
 * what stays as it was is no loosening.
 */
const loosensAutoApprove = (
  before: { enabled: boolean; lowWithoutAi: boolean },
  patch: { enabled?: boolean; lowWithoutAi?: boolean } | undefined,
) => {
  const after = { ...before, ...patch };
  // Low risk without the AI approves nothing while the approval is off; the protocol fills a bare
  // `{ enabled: false }` with its defaults, so a turn off must not count for them.
  return after.enabled && (!before.enabled || (after.lowWithoutAi && !before.lowWithoutAi));
};

export const projectHandlers = {
  "project.list": async (_payload, { server }) => {
    const board = server.need("board");
    return {
      projects: await Promise.all(board.listProjects().map((p) => board.forWire(p))),
      maxParallelRuns: board.maxParallelRuns,
    };
  },
  "project.add": async (payload, { ws, server }) => {
    // A new project starts with it off: only turning it on is a loosening (#3815).
    if (payload.autoApprove?.enabled === true)
      requireVaultTransport(ws.data.origin, "project.add", server.opts.log);
    // A setup script runs with `sh -c` on the host when a card starts: setting one is near only, as
    // trusting a run config is. Anything else about a project answers anywhere (#3807).
    // The prompt template goes into every card's first prompt, and the model decides what the
    // automatic approval lets through: a custom one is near only (#3825).
    if (
      payload.setupScript?.trim() ||
      (payload.promptTemplate !== undefined &&
        payload.promptTemplate !== DEFAULT_PROMPT_TEMPLATE) ||
      (payload.autoApprove?.model !== undefined && payload.autoApprove.model !== DEFAULT_MODEL)
    )
      requireVaultTransport(ws.data.origin, "project.add", server.opts.log);
    const board = server.need("board");
    return await board.forWire(await board.addProject(payload));
  },
  "project.update": async (payload, { ws, server }) => {
    const { projectId, ...patch } = payload;
    // Turning the automatic approval on, or letting it approve low risk without the AI, is near only;
    // turning it off is not (#3815).
    const board = server.need("board");
    const stored = board.getProject(projectId);
    const model = patch.autoApprove?.model;
    // A setup script is near only to set (clearing it, null or blank, is not, #3807). A prompt template
    // or an approving model that differs from the stored one is near only too: the app and the CLI send
    // the stored values back with a change, and a patch that only turns the approval off carries the
    // default model, which is no change worth refusing (#3825).
    if (
      (patch.autoApprove && loosensAutoApprove(stored.autoApprove, patch.autoApprove)) ||
      patch.setupScript?.trim() ||
      (patch.promptTemplate !== undefined && patch.promptTemplate !== stored.promptTemplate) ||
      (model !== undefined && model !== stored.autoApprove.model && model !== DEFAULT_MODEL)
    )
      requireVaultTransport(ws.data.origin, "project.update", server.opts.log);
    return await board.forWire(board.updateProject(projectId, patch));
  },
  "project.detectProvider": async (payload, { server }) => {
    const board = server.need("board");
    const project = board.getProject(payload.projectId);
    const found = await detectProvider(project, server.opts.projectGit);
    // The project form may have saved while git was reading: what the person set stays.
    const fresh = board.getProject(payload.projectId);
    if (fresh.prProvider !== "none")
      return { project: await board.forWire(fresh), outcome: "kept" as const, host: null };
    // Saved the way the project form saves it, so the board and every window see the new provider.
    const now = found.provider
      ? board.updateProject(payload.projectId, { prProvider: found.provider })
      : fresh;
    return { project: await board.forWire(now), outcome: found.outcome, host: found.host };
  },
  "project.trust.state": async (payload, { server }) => {
    const trust = server.needIn("projects", "trust");
    const paths = await Promise.all(
      payload.paths.map((p) => resolveAllowedCwd(p, server.opts.allowedRoots)),
    );
    await trust.refresh(paths);
    return { items: trust.state(paths) };
  },
  "project.trust.inspect": async (payload, { ws, server }) => {
    const trust = server.needIn("projects", "trust");
    // Commands and server arguments are shown whole, a secret in one included: a near connection only.
    requireVaultTransport(ws.data.origin, "project.trust.inspect", server.opts.log);
    const path = await resolveAllowedCwd(payload.path, server.opts.allowedRoots);
    return await trust.inspect(path);
  },
  "project.trust.set": async (payload, { ws, server }) => {
    const trust = server.needIn("projects", "trust");
    // Trusting lets the project's own hooks and MCP servers run without a prompt: only from a near
    // connection, like roots.add and host.bypass. Revoking only lowers risk.
    if (payload.trusted)
      requireVaultTransport(ws.data.origin, "project.trust.set", server.opts.log);
    const path = await resolveAllowedCwd(payload.path, server.opts.allowedRoots);
    // A folder above a root, or a root that is not one repository, holds many projects:
    // trusting it would trust every clone inside (#592).
    if (
      payload.trusted &&
      (await trustsManyProjects(path, await rootNames(server.opts.allowedRoots), diskTrustRootFs))
    ) {
      throw new FlightdeckError(
        "invalid_state",
        "trusting this folder would trust every project inside it",
        "trust_root_refused",
      );
    }
    // #3453: with a device enrolled, the person signs the folder the daemon trusts. A link or a relative path
    // that resolves elsewhere is refused with the folder it is. The app signs the folder the host reported
    // for the project, so it meets this only when that report is stale.
    const approvers = server.opts.approvers;
    if (approvers?.needsCommandProof("project.trust.set", payload) && path !== payload.path) {
      throw new FlightdeckError(
        "invalid_state",
        "the folder is another one than the folder named",
        "trust_path_differs",
        { path },
      );
    }
    approvers?.requireCommandProof("project.trust.set", payload, ["path"]);
    await trust.refresh();
    const done = trust.set(path, payload.trusted);
    // The boundary read before the record existed (a `state` call on a nested clone) would make the
    // answer say untrusted: read it again, now that the record is there (#1704).
    await trust.refresh([path]);
    return trust.state([path])[0] ?? done;
  },
  "project.harness.stack": async (payload, { server }) => {
    const stack = server.needIn("harness", "stack");
    const path = await resolveAllowedCwd(payload.path, server.opts.allowedRoots);
    return await stack(path);
  },
  "project.harness.preview": async (payload, { ws, server }) => {
    const preview = server.needIn("harness", "preview");
    const { parts, template } = payload;
    // A template's files come back whole, and T1a keeps them off a far connection: near only.
    if (template !== undefined) {
      requireVaultTransport(ws.data.origin, "project.harness.preview", server.opts.log);
    }
    const path = await resolveAllowedCwd(payload.path, server.opts.allowedRoots);
    return await preview(path, parts, await markdownOf(server, template));
  },
  "project.harness.export": async (payload, { ws, server }) => {
    const templates = server.needIn("harness", "templates");
    // It reads a project's instructions into a store any project of the host can use: near only.
    requireVaultTransport(ws.data.origin, "project.harness.export", server.opts.log);
    const path = await resolveAllowedCwd(payload.path, server.opts.allowedRoots);
    const { id, title } = payload;
    return await templates.export(path, id, title);
  },
  "project.harness.draft": async (payload, { ws, server }) => {
    const draft = server.needIn("harness", "draft");
    // A model call on the plan, whose text a later apply may write: a near connection only.
    requireVaultTransport(ws.data.origin, "project.harness.draft", server.opts.log);
    const path = await resolveAllowedCwd(payload.path, server.opts.allowedRoots);
    return await draft(path);
  },
  "project.harness.commit": async (payload, { ws, server }) => {
    const commit = server.needIn("harness", "commit");
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
    const apply = server.needIn("harness", "apply");
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
    // #3507: with a device enrolled, the person signs the whole request, and the folder in it is the folder
    // the host writes to: a link or a relative path that resolves elsewhere is refused with the folder it is.
    // The proof is checked after every refusal that does not need it, so those never spend a challenge.
    const approvers = server.opts.approvers;
    if (approvers?.needsCommandProof("project.harness.apply", payload) && path !== payload.path) {
      throw new FlightdeckError(
        "invalid_state",
        "the folder is another one than the folder named",
        "harness_path_differs",
        { path },
      );
    }
    approvers?.requireCommandProof("project.harness.apply", payload, ["path", "parts", "digests"]);
    return await apply(path, parts, digests, {
      reformat: reformat === true,
      ...(markdown ? { template: markdown } : {}),
    });
  },
  "harness.templates.list": async (_payload, { server }) => {
    const templates = server.needIn("harness", "templates");
    return { templates: await templates.list() };
  },
  "harness.templates.delete": async (payload, { ws, server }) => {
    const templates = server.needIn("harness", "templates");
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
    if (!server.opts.projects?.find) throw featureOff("projects.scan");
    const { depth } = payload;
    return await scanRepos(server.opts.allowedRoots, depth ? { depth } : {});
  },
  "projects.clone": async (payload, { server }) => {
    if (!server.opts.projects?.find) throw featureOff("projects.clone");
    return await cloneRepo(payload, server.opts.allowedRoots, server.opts.git ?? spawnGit);
  },
} satisfies Partial<Handlers>;
