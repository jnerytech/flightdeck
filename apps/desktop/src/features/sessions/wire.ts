import type { AppKernel } from "../../lib/kernel.ts";
import { type SessionCommandsCore, SessionCommandsSlice } from "./commands.ts";
import { type ExternalSessionsCore, ExternalSessionsSlice } from "./external.ts";
import { type FinishedCore, FinishedSlice } from "./finished.ts";
import { type SessionListsCore, SessionListsSlice } from "./lists.ts";
import { type SessionsCore, SessionsSlice, type SessionsSliceState } from "./store.ts";
import { type SessionStreamCore, SessionStreamSlice } from "./stream.ts";
import { type OpenSession, SessionSubscriptions } from "./subscriptions.ts";
import { type SummariesCore, SummariesSlice } from "./summaries.ts";

/*
 * The sessions domain's slices, built from the store's kernel (#1596). Each takes from the kernel
 * the state it reads, the host's connection, the clock, the translator and the banner; what only
 * the store has (another slice, the router, the platform, the store's own helpers) stays a dep.
 */

/** The interrupted sessions' resume offers, kept in the state and the storage. */
export function wireSessions(
  kernel: AppKernel<SessionsSliceState>,
  deps: Pick<SessionsCore, "storage">,
): SessionsSlice {
  return new SessionsSlice({
    state: () => kernel.state(),
    update: (patch) => kernel.update(patch),
    storage: deps.storage,
    connection: (hostId) => kernel.connection(hostId),
    t: () => kernel.t(),
    success: (text) => kernel.success(text),
  });
}

/** The commands on a session (open, stop, send) through the host's connection. */
export function wireSessionCommands(
  kernel: AppKernel<{ selected: ReturnType<SessionCommandsCore["selected"]> }>,
  deps: Pick<SessionCommandsCore, "opened">,
): SessionCommandsSlice {
  return new SessionCommandsSlice({
    connection: (hostId) => kernel.connection(hostId),
    selected: () => kernel.state().selected,
    fail: (error, text, retry) => kernel.fail(error, text, retry),
    opened: deps.opened,
    sleep: (hostId, sessionId) => kernel.hostCommand(hostId, "session.sleep", { sessionId }),
    success: (text) => kernel.success(text),
    t: () => kernel.t(),
  });
}

/** The sessions Claude Code runs outside the daemon, and their permission requests. */
export function wireExternalSessions(
  kernel: AppKernel<ReturnType<ExternalSessionsCore["state"]>>,
  deps: Pick<
    ExternalSessionsCore,
    "projectOf" | "isFocused" | "notify" | "feedSession" | "feedPermission"
  >,
): ExternalSessionsSlice {
  return new ExternalSessionsSlice({
    state: () => kernel.state(),
    patch: (patch) => kernel.update(patch),
    projectOf: deps.projectOf,
    isFocused: deps.isFocused,
    t: () => kernel.t(),
    notify: deps.notify,
    feedSession: deps.feedSession,
    feedPermission: deps.feedPermission,
  });
}

/** The sessions that finished, kept for Needs you, with their file counts asked of the host. */
export function wireFinished(
  kernel: AppKernel<ReturnType<FinishedCore["state"]>>,
  deps: Pick<FinishedCore, "storage" | "isFocused" | "shown">,
): FinishedSlice {
  return new FinishedSlice({
    state: () => kernel.state(),
    update: (patch) => kernel.update(patch),
    storage: deps.storage,
    now: () => kernel.now(),
    isFocused: deps.isFocused,
    shown: deps.shown,
    changes: (hostId, target) => kernel.hostRequest(hostId, "changes.get", { target }),
  });
}

/** A host's session lists (the hub, the names, the meta), asked on its connection. */
export function wireSessionLists(
  kernel: AppKernel<
    ReturnType<SessionListsCore["state"]> & Required<Parameters<SessionListsCore["patch"]>[0]>
  >,
  deps: Pick<SessionListsCore, "backgroundPatch">,
): SessionListsSlice {
  return new SessionListsSlice({
    state: () => kernel.state(),
    patch: (patch) => kernel.update(patch),
    connection: (hostId) => kernel.connection(hostId),
    backgroundPatch: deps.backgroundPatch,
    setMeta: (hostId, payload) => kernel.hostCommand(hostId, "session.meta.set", payload),
  });
}

/** The conversations the app holds, fed by a host's session events. */
export function wireSessionStream(
  kernel: AppKernel<{ sessions: ReturnType<SessionStreamCore["sessions"]> }>,
  deps: Pick<SessionStreamCore, "summary">,
): SessionStreamSlice {
  return new SessionStreamSlice({
    sessions: () => kernel.state().sessions,
    setSessions: (sessions) => kernel.update({ sessions }),
    summary: deps.summary,
    resync: (hostId, sessionId) => kernel.connection(hostId)?.resync(sessionId),
  });
}

/** The sessions that keep a subscription to their full event stream: the open one and the followed. */
export function wireSessionSubscriptions(
  kernel: AppKernel<{ selected: OpenSession | null }>,
): SessionSubscriptions {
  return new SessionSubscriptions({
    selected: () => kernel.state().selected,
    setSelected: (selected) => kernel.update({ selected }),
    subscribe: (hostId, sessionId) => kernel.connection(hostId)?.subscribe(sessionId),
    unsubscribe: (hostId, sessionId) => kernel.connection(hostId)?.unsubscribe(sessionId),
  });
}

/** The sidebar's session summaries, their unread marks and the notices they raise. */
export function wireSummaries(
  kernel: AppKernel<{
    hosts: ReturnType<SummariesCore["hosts"]>;
    unread: Record<string, boolean>;
  }>,
  deps: Omit<SummariesCore, "hosts" | "markUnread" | "now" | "t">,
): SummariesSlice {
  return new SummariesSlice({
    ...deps,
    hosts: () => kernel.state().hosts,
    markUnread: (keys) =>
      kernel.update({
        unread: { ...kernel.state().unread, ...Object.fromEntries(keys.map((key) => [key, true])) },
      }),
    now: () => kernel.now(),
    t: () => kernel.t(),
  });
}
