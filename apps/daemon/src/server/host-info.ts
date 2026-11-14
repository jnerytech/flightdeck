/**
 * Issue #1288: what `host.info` says about this host (`features.ts` lists what it announces). It lives
 * beside the handler that answers it, so `server.ts` no longer reads every option to build it.
 */
import { ASSISTANT_FEATURE, type HostRuntime } from "@flightdeck/protocol";
import { DAEMON_VERSION, present } from "../kernel/index.ts";
import { logPathFor } from "../logs/serve.ts";
import type { OpenCodeInfo } from "../runtime/index.ts";
import { isVaultTransport } from "../vault/index.ts";
import type { ServerContext } from "./context.ts";
import { when } from "./features.ts";

/** What `host.info` says about OpenCode: no executable fingerprint, no finding paths. */
function hostRuntime(info: OpenCodeInfo): HostRuntime {
  return {
    kind: "opencode",
    available: info.available,
    ...(info.path ? { path: info.path } : {}),
    ...(info.version ? { version: info.version } : {}),
    ...(info.verified !== undefined ? { verified: info.verified } : {}),
    ...(info.reason ? { reason: info.reason } : {}),
  };
}

/** The answer to `host.info`: the host's identity, what it runs and what it is set to. */
export async function hostInfo(server: ServerContext, origin: string) {
  const { opts } = server;
  // `update` once the daemon has checked its manifest.
  const update = opts.updates?.check?.status();
  return {
    hostName: opts.hostName,
    os: process.platform,
    arch: process.arch,
    daemonVersion: DAEMON_VERSION,
    claudeVersion: (await opts.claude?.version()) ?? null,
    claudePath: opts.claude?.path ?? null,
    uptimeSec: Math.floor((Date.now() - server.startedAt) / 1000),
    activeSessions: server.manager.activeSessionCount(),
    apiKeySanitized: server.manager.apiKeySanitized(),
    // Issue #1361: whether this connection is near (loopback or Tailscale); only a near one may
    // change what runs unattended, so the app shows those settings read-only otherwise.
    near: isVaultTransport(origin),
    // The terminal can be turned on and off while the daemon runs: asked each time.
    features: [
      ...(opts.features ?? server.features),
      ...when(opts.terminals?.enabled, "terminal", "terminal.session"),
      // Issue #506: a path a terminal printed opens in the Files viewer, from its folder.
      ...when(opts.terminals?.enabled && opts.review?.files, "file.terminal"),
      ...when(opts.ui, "ui.mode"),
      ...when(opts.agentSetup?.templates, "templates"),
      ...when(opts.agentSetup?.tasks, "tasks"),
      ...when(opts.opencode?.info().available, "opencode"),
      ...when(opts.assistant, ASSISTANT_FEATURE),
      ...when(opts.teleport?.packages || opts.teleport?.inbox, "teleport"),
      ...when(opts.updates?.auto, "autoUpdate"),
    ],
    ...present({
      terminal: opts.terminals?.settings(),
      ui: opts.ui && { ...opts.ui },
      allowBypassPermissions: opts.sessionSettings?.bypass?.allowed(),
      sleepAfterMinutes: opts.sessionSettings?.sleep?.minutes(),
      keepAwake: opts.keepAwake?.status(),
      pause: opts.hostPause?.status(),
      runtimes: opts.opencode && [hostRuntime(opts.opencode.info())],
      update,
      autoUpdate: opts.updates?.auto?.status(),
    }),
    ...(opts.fileLog ? logPathFor(opts.fileLog, origin) : {}),
    ...opts.terminal,
  };
}
