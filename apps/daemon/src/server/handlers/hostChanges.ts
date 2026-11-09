/**
 * Issue #1288: the commands that change the host: end an orphan process, install the service, add
 * an allowed root, and set how the host presents itself.
 */
import { FlightdeckError } from "../../errors.ts";
import { addAllowedRoot } from "../../roots.ts";
import { requireVaultTransport } from "../../vault/vault.ts";
import type { Handlers } from "../dispatch.ts";

export const hostChangesHandlers = {
  "resources.endOrphan": async (payload, { ws, server }) => {
    // Like the other commands that change the host: not from beyond loopback and Tailscale.
    requireVaultTransport(ws.data.origin, "resources.endOrphan", server.opts.log);
    await server.need("resources").endOrphan(payload.pid, payload.startTicks);
    return { ended: true };
  },
  "service.install": async (payload, { server }) => {
    return await server.need("serviceInstall")(payload.confirm === true);
  },
  "roots.add": async (payload, { ws, server }) => {
    const { opts } = server;
    requireVaultTransport(ws.data.origin, "roots.add", opts.log);
    const { path, confirm } = payload;
    return {
      allowedRoots: await addAllowedRoot(
        opts.allowedRoots as string[],
        path,
        confirm === true,
        opts.persistRoots,
        opts.rootsPlatform,
      ),
    };
  },
  "ui.set": async (payload, { server }) => {
    const ui = server.need("ui");
    const { mode, locked, confirm } = payload;
    if (confirm !== true) {
      throw new FlightdeckError(
        "invalid_state",
        "changing how this host presents itself needs confirm: true",
        "ui_confirm",
      );
    }
    const next = { mode: mode ?? ui.mode, locked: locked ?? ui.locked };
    await server.opts.onUiSettings?.(next);
    ui.mode = next.mode;
    ui.locked = next.locked;
    return { ...next };
  },
} satisfies Partial<Handlers>;
