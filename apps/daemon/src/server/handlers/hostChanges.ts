/**
 * Issue #1288: the commands that change the host: end an orphan process, install the service, add
 * an allowed root, and set how the host presents itself.
 */
import { FlightdeckError } from "../../errors.ts";
import { addAllowedRoot } from "../../projects/index.ts";
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
    const allowedRoots = await addAllowedRoot(
      opts.allowedRoots as string[],
      path,
      confirm === true,
      opts.roots?.persist,
      opts.roots?.platform,
    );
    // The trust's view of the roots (which one is a project of its own) is a snapshot: read it
    // again, so the gates that read it without asking do not use the old list (#1738).
    await opts.projects?.trust?.refresh();
    return { allowedRoots };
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
