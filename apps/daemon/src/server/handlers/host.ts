/**
 * Issue #1288: the host domain: the host's own controls (sleep, keep awake, bypass permissions,
 * auto update), the daemon's update and shutdown, the maintenance jobs and the Claude hooks. The
 * ones that change what the host may run need a near connection, as before the split.
 */
import { FlightdeckError, featureOff } from "../../errors.ts";
import { requireVaultTransport } from "../../vault/vault.ts";
import { afterAck, type Handlers } from "../dispatch.ts";

export const hostHandlers = {
  "resources.setPauseAt": async (payload, { server }) => {
    // Like quota.setPauseAt: it only decides whether a new card starts now or waits; nothing stops.
    await server.need("memoryPause").set(payload.pauseAt);
    return { pauseAt: payload.pauseAt };
  },
  "host.pause": async (payload, { ws, server }) => {
    // It decides whether this host starts new runs: a near connection only, like its other switches.
    requireVaultTransport(ws.data.origin, "host.pause", server.opts.log);
    const pause = server.need("hostPause");
    await pause.set(payload.paused);
    return pause.status();
  },
  "host.sleep": async (payload, { server }) => {
    const { sleep } = server.opts;
    if (!sleep) throw featureOff("sleep");
    await sleep.set(payload.minutes);
    return { sleepAfterMinutes: payload.minutes };
  },
  "host.updates.set": async (payload, { ws, server }) => {
    // It lets the host download and run a new binary by itself: only from a near connection,
    // like host.bypass. Turning it off only lowers risk, but it is the same switch.
    requireVaultTransport(ws.data.origin, "host.updates.set", server.opts.log);
    const { autoUpdate } = server.opts;
    if (!autoUpdate) throw featureOff("autoUpdate");
    return await autoUpdate.set(payload.auto);
  },
  "host.bypass": async (payload, { ws, server }) => {
    requireVaultTransport(ws.data.origin, "host.bypass", server.opts.log);
    const { allow, confirm } = payload;
    const bypass = server.need("bypass");
    if (allow && confirm !== true) {
      throw new FlightdeckError(
        "invalid_state",
        "allowing sessions without permission prompts needs confirm: true",
        "bypass_confirm",
      );
    }
    await bypass.set(allow);
    return { allowBypassPermissions: allow };
  },
  "host.keepAwake": async (payload, { server }) => {
    const { keepAwake } = server.opts;
    if (!keepAwake) throw featureOff("keepAwake");
    await keepAwake.set(payload.enabled);
    return keepAwake.status();
  },
  "daemon.update.apply": async (payload, { server }) => {
    return await server.need("updater").apply(payload.confirm === true);
  },
  "daemon.update.check": async (_payload, { server }) => {
    return await server.need("updates").checkNow();
  },
  "daemon.shutdown": (_payload, { server }) => {
    const { onShutdown } = server.opts;
    if (!onShutdown) throw featureOff("shutdown");
    // Right after the ack is written (a microtask, not a timer tick that may come late).
    return afterAck(undefined, () => queueMicrotask(onShutdown));
  },
  "maintenance.status": async (_payload, { server }) => {
    return await server.need("maintenance").status();
  },
  "maintenance.backup": async (_payload, { server }) => {
    return await server.need("maintenance").backupNow();
  },
  "maintenance.prune": async (payload, { server }) => {
    return await server.need("maintenance").prune(payload.dryRun === true);
  },
  "hooks.status": async (_payload, { server }) => {
    return await server.need("central").hooksStatus();
  },
  "hooks.install": async (payload, { server }) => {
    return await server.need("central").hooksInstall(payload.confirm === true);
  },
  "hooks.uninstall": async (payload, { server }) => {
    return await server.need("central").hooksUninstall(payload.confirm === true);
  },
} satisfies Partial<Handlers>;
