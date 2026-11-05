/**
 * Issue #248: the costs domain: costs, budgets, the plan quota, the account, usage and telemetry.
 */
import type { Handlers } from "../dispatch.ts";

export const costsHandlers = {
  "costs.status": (_payload, { server }) => {
    return server.need("costs").status();
  },
  "costs.reprice": async (_payload, { server }) => {
    return await server.need("costs").reprice();
  },
  "costs.summary": (payload, { server }) => {
    return server.need("costs").summary(payload);
  },
  "telemetry.session": (payload, { server }) => {
    return server.need("telemetry").timeline(payload.claudeSessionId);
  },
  "telemetry.status": async (_payload, { server }) => {
    return await server.need("telemetryOptIn").status();
  },
  "telemetry.install": async (payload, { server }) => {
    return await server.need("telemetryOptIn").install(payload.confirm === true);
  },
  "telemetry.uninstall": async (payload, { server }) => {
    return await server.need("telemetryOptIn").uninstall(payload.confirm === true);
  },
  "telemetry.summary": (_payload, { server }) => {
    return server.need("telemetry").summary();
  },
  "costs.session": (payload, { server }) => {
    return server.need("costs").session(payload.claudeSessionId);
  },
  "costs.sessions": (payload, { server }) => {
    return { costs: server.need("costs").sessions(payload.claudeSessionIds) };
  },
  "costs.card": (payload, { server }) => {
    return { costUsd: server.need("costs").card(payload.cardId) };
  },
  "costs.run": (payload, { server }) => {
    return { costUsd: server.need("costs").run(payload.runId) };
  },
  "costs.export": (payload, { server }) => {
    return server.need("costs").export(payload);
  },
  "budget.list": (_payload, { server }) => {
    return { budgets: server.need("budgets").list() };
  },
  "budget.set": (payload, { server }) => {
    return server.need("budgets").set(payload);
  },
  "budget.remove": (payload, { server }) => {
    server.need("budgets").remove(payload.id);
  },
  "budget.watch": (_payload, { ws, send, server }) => {
    const host = server.need("budgets");
    ws.data.unwatchBudgets?.();
    ws.data.unwatchBudgets = host.watch((update) => send({ type: "budget.updated", ...update }));
  },
  "quota.history": (payload, { server }) => {
    return server.need("quotaHistory").history(payload.window, payload.hours);
  },
  "usage.summary": (payload, { server }) => {
    return server.need("usage").summary(payload.days);
  },
  "quota.get": (_payload, { server }) => {
    return server.need("quota").state();
  },
  "quota.watch": (_payload, { ws, send, server }) => {
    const host = server.need("quota");
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
