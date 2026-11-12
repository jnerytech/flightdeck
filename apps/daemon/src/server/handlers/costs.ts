/**
 * Issue #248: the costs domain: costs, budgets, the plan quota, the account, usage and telemetry.
 */
import { featureOff } from "../../kernel/index.ts";
import type { Handlers } from "../dispatch.ts";

export const costsHandlers = {
  "costs.status": (_payload, { server }) => {
    return server.needIn("costs", "costs").status();
  },
  "costs.reprice": async (_payload, { server }) => {
    return await server.needIn("costs", "costs").reprice();
  },
  "costs.summary": (payload, { server }) => {
    return server.needIn("costs", "costs").summary(payload);
  },
  "telemetry.session": (payload, { server }) => {
    return server.needIn("telemetry", "store").timeline(payload.claudeSessionId);
  },
  "telemetry.status": async (_payload, { server }) => {
    return await server.needIn("telemetry", "optIn").status();
  },
  "telemetry.install": async (payload, { server }) => {
    return await server.needIn("telemetry", "optIn").install(payload.confirm === true);
  },
  "telemetry.uninstall": async (payload, { server }) => {
    return await server.needIn("telemetry", "optIn").uninstall(payload.confirm === true);
  },
  "telemetry.summary": (_payload, { server }) => {
    return server.needIn("telemetry", "store").summary();
  },
  "costs.session": (payload, { server }) => {
    return server.needIn("costs", "costs").session(payload.claudeSessionId);
  },
  "costs.sessions": (payload, { server }) => {
    return { costs: server.needIn("costs", "costs").sessions(payload.claudeSessionIds) };
  },
  "costs.card": (payload, { server }) => {
    return { costUsd: server.needIn("costs", "costs").card(payload.cardId) };
  },
  "costs.run": (payload, { server }) => {
    return { costUsd: server.needIn("costs", "costs").run(payload.runId) };
  },
  "costs.export": (payload, { server }) => {
    return server.needIn("costs", "costs").export(payload);
  },
  "budget.list": (_payload, { server }) => {
    return { budgets: server.needIn("costs", "budgets").list() };
  },
  "budget.set": (payload, { server }) => {
    return server.needIn("costs", "budgets").set(payload);
  },
  "budget.setQuota": (payload, { server }) => {
    const budgets = server.needIn("costs", "budgets");
    // A host without the plan quota does not announce `quotaBudgets`: it refuses the command.
    if (!budgets.opts.quota) throw featureOff("quotaBudgets");
    return budgets.setWindow(payload);
  },
  "budget.remove": (payload, { server }) => {
    server.needIn("costs", "budgets").remove(payload.id);
  },
  "budget.watch": (_payload, { ws, send, server }) => {
    const host = server.needIn("costs", "budgets");
    ws.data.unwatchBudgets?.();
    ws.data.unwatchBudgets = host.watch((update) => send({ type: "budget.updated", ...update }));
  },
  "quota.history": (payload, { server }) => {
    return server.needIn("quota", "history").history(payload.window, payload.hours);
  },
  "usage.summary": (payload, { server }) => {
    return server.need("usage").summary(payload.days);
  },
  "quota.get": (_payload, { server }) => {
    return server.needIn("quota", "windows").state();
  },
  "quota.setPauseAt": async (payload, { server }) => {
    // The quota first: a host without it refuses before anything is written.
    const quota = server.needIn("quota", "windows");
    await server.needIn("quota", "pause").set(payload.pauseAt);
    return quota.state();
  },
  "quota.watch": (_payload, { ws, send, server }) => {
    const host = server.needIn("quota", "windows");
    ws.data.unwatchQuota?.();
    ws.data.unwatchQuota = host.watch((state) => send({ type: "quota.updated", ...state }));
  },
  "account.get": async (_payload, { server }) => {
    return await server.need("account").get();
  },
  "account.watch": (_payload, { ws, send, server }) => {
    const host = server.need("account");
    ws.data.unwatchAccount?.();
    ws.data.unwatchAccount = host.watch((state) => send({ type: "account.updated", ...state }));
  },
  "account.unwatch": (_payload, { ws, server }) => {
    server.need("account");
    ws.data.unwatchAccount?.();
    ws.data.unwatchAccount = undefined;
  },
  "account.refresh": async (_payload, { server }) => {
    return await server.need("account").refresh();
  },
} satisfies Partial<Handlers>;
