/**
 * Issue #248: the runs domain: run environments and runs, workflows, templates and their tasks,
 * automations, and webhooks.
 */
import { FlightdeckError, featureOff } from "../../errors.ts";
import { startTemplate } from "../../templates/start.ts";
import type { Handlers } from "../dispatch.ts";

export const runsHandlers = {
  "automation.list": (payload, { server }) => {
    return { automations: server.need("automations").list(payload.projectId) };
  },
  "automation.save": (payload, { server }) => {
    return server.need("automations").save(payload);
  },
  "automation.remove": (payload, { server }) => {
    return {
      automations: server.need("automations").remove(payload.id, payload.confirm === true),
    };
  },
  "automation.toggle": (payload, { server }) => {
    const { id, enabled, confirm } = payload;
    return server.need("automations").toggle(id, enabled, confirm === true);
  },
  "automation.runs": (payload, { server }) => {
    return {
      runs: server.need("automations").runs(payload.id, payload.limit),
    };
  },
  "workflow.list": async (payload, { server }) => {
    return {
      workflows: await server.need("board").listWorkflows(payload.projectId),
    };
  },
  "workflow.validate": async (payload, { server }) => {
    const { projectId, name } = payload;
    return await server.need("board").validateWorkflow(projectId, name);
  },
  "workflow.trust": async (payload, { server }) => {
    const { projectId, name, hash } = payload;
    return await server.need("board").trustWorkflow(projectId, name, hash);
  },
  "run.get": (payload, { server }) => {
    return server.need("board").workflows.getRun(payload.runId);
  },
  "webhook.send": async (payload, { ws, server }) => {
    return await server.need("webhook").send(payload, ws.data.origin);
  },
  "template.list": async (_payload, { server }) => {
    if (!server.opts.templates) throw featureOff("templates");
    return await server.opts.templates();
  },
  "template.start": async (payload, { server }) => {
    if (!server.opts.templates) throw featureOff("templates");
    const { templateId, language, values, name } = payload;
    const template = (await server.opts.templates()).templates.find((t) => t.id === templateId);
    if (!template) {
      throw new FlightdeckError(
        "not_found",
        `there is no template ${templateId}`,
        "template_unknown",
        { id: templateId },
      );
    }
    return await startTemplate(
      template,
      language,
      values,
      {
        allowedRoots: server.opts.allowedRoots,
        create: (payload) => server.manager.create(payload),
        ...(server.opts.tasks ? { tasks: server.opts.tasks } : {}),
      },
      name,
    );
  },
  "task.preview": async (payload, { server }) => {
    if (!server.opts.tasks) throw featureOff("tasks");
    return await server.opts.tasks.preview(payload.sessionId, payload.path);
  },
  "task.results": async (payload, { server }) => {
    if (!server.opts.tasks) throw featureOff("tasks");
    return await server.opts.tasks.results(payload.sessionId);
  },
  "runenv.config": async (payload, { server }) => {
    return await server
      .need("runenv")
      .configs.info(server.need("board").getProject(payload.projectId));
  },
  "runenv.trust": async (payload, { server }) => {
    const { projectId, hash } = payload;
    return await server
      .need("runenv")
      .configs.trust(server.need("board").getProject(projectId), hash);
  },
  "runenv.start": async (payload, { server }) => {
    return await server.need("runenv").manager.start(payload.cardId);
  },
  "runenv.stop": async (payload, { server }) => {
    return await server.need("runenv").manager.stop(payload.cardId);
  },
  "runenv.get": (payload, { server }) => {
    return server.need("runenv").manager.state(payload.cardId);
  },
  "runenv.watch": (_payload, { ws, send, server }) => {
    // Ack, the runs going now, then every change.
    const { manager } = server.need("runenv");
    ws.data.unwatchRunEnv?.();
    ws.data.unwatchRunEnv = manager.watch((state) => send({ type: "runenv.updated", state }));
    undefined;
    for (const state of manager.live()) send({ type: "runenv.updated", state });
  },
  "run.watch": (_payload, { ws, send, server }) => {
    // Ack, the runs still going, then every change: the app sees open gates right away.
    const runs = server.need("board").workflows;
    ws.data.unwatchRuns?.();
    ws.data.unwatchRuns = runs.watch((run) => send({ type: "run.updated", run }));
    undefined;
    for (const run of runs.activeRuns()) send({ type: "run.updated", run });
  },
} satisfies Partial<Handlers>;
