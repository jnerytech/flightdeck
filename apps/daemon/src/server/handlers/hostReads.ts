/**
 * Issue #1288: the host readouts: logs, releases, names, idle, ROI, the statusline, resources, the
 * dependency and doctor checks, and the runtime models.
 */
import { statuslineData } from "../../costs/statusline.ts";
import { FlightdeckError } from "../../kernel/index.ts";
import { tailForOrigin } from "../../logs/serve.ts";
import { localDay } from "../../quota/usage.ts";
import { roiPeriod } from "../../roi/summary.ts";
import type { Handlers } from "../dispatch.ts";

export const hostReadsHandlers = {
  "logs.tail": async (payload, { ws, server }) => {
    const { opts } = server;
    return await tailForOrigin(
      server.need("fileLog"),
      ws.data.origin,
      payload.lines ?? 100,
      opts.log,
    );
  },
  "releases.list": async (payload, { server }) => {
    return await server.need("releases").list(payload.limit ?? 5);
  },
  "resources.get": async (_payload, { server }) => {
    const snapshot = await server.need("resources").snapshot();
    // Issue #1343: the memory hold's threshold travels with the reading the panel shows.
    // Issue #1414: and whether it holds now, by the gate's own rule, so the app need not guess.
    const pause = server.opts.memoryPause;
    if (!pause) return snapshot;
    const holding = pause.holding ? { memoryHolding: pause.holding() } : {};
    return { ...snapshot, memoryPauseAt: pause.pauseAt(), ...holding };
  },
  "names.list": (_payload, { server }) => {
    return {
      names: server
        .need("names")
        .list()
        .map(({ id, ...name }) => ({ sessionId: id, ...name })),
    };
  },
  "idle.subscribe": (payload, { server }) => {
    return server.needIn("messaging", "idle").subscribe(payload);
  },
  "roi.summary": async (payload, { server }) => {
    return await server.need("roi").summaryWithSignals(roiPeriod(payload));
  },
  "runtime.models": async (_payload, { server }) => {
    const { opencode } = server.opts;
    if (!opencode?.info().available) {
      throw new FlightdeckError(
        "invalid_state",
        "OpenCode is not available on this host",
        "runtime_unavailable",
      );
    }
    return { models: await opencode.models() };
  },
  "deps.check": async (_payload, { server }) => {
    return await server.needIn("hostChecks", "deps")();
  },
  "doctor.run": async (payload, { server }) => {
    return await server.needIn("hostChecks", "doctor")(payload.appVersion);
  },
  "statusline.get": (payload, { server }) => {
    const costs = server.opts.costs?.costs;
    const quota = server.opts.quota?.windows;
    const { claudeSessionId } = payload;
    return statuslineData({
      ...(quota ? { quota } : {}),
      ...(costs ? { costs } : {}),
      today: localDay(Date.now()),
      ...(claudeSessionId ? { claudeSessionId } : {}),
    });
  },
} satisfies Partial<Handlers>;
