import type {
  ExternalPermissionFrame,
  ExternalSession,
  ExternalUpdated,
} from "@flightdeck/protocol";
import { requestLink } from "@/features/permissions/index.ts";
import { basename } from "@/shared/lib/index.ts";
import type { T } from "../../i18n/index.ts";
import type { AppState } from "../../lib/app-store.ts";
import { externalRequestNotification, externalWaitNotification } from "../inbox/domain/notify.ts";
import type { InboxSlice } from "../inbox/index.ts";
import { sessionKey } from "./domain/session-key.ts";

type ExternalState = Pick<AppState, "hosts" | "externals" | "meta" | "externalRequests" | "hub">;
type ExternalPatch = Partial<Pick<AppState, "externals" | "meta" | "externalRequests">>;

/** What the external sessions read and ask through the app's store. */
export interface ExternalSessionsCore {
  /** What the app holds about hosts, terminal sessions and their requests. */
  state(): ExternalState;
  /** Changes what the app holds about terminal sessions, as one change. */
  patch(patch: ExternalPatch): void;
  /** `hostId/projectId` of the project whose folder holds `cwd`, if any. */
  projectOf(hostId: string, cwd: string | null | undefined): string | undefined;
  isFocused(): boolean;
  t(): T;
  notify: InboxSlice["notify"];
  /** A terminal session that ended, for the webhooks. */
  feedSession(
    host: { id: string; name: string },
    prev: ExternalSession | undefined,
    next: ExternalSession,
  ): void;
  /** A terminal session's open permission request, for the webhooks. */
  feedPermission(
    host: { id: string; name: string },
    frame: ExternalPermissionFrame,
    cwd: string | null,
  ): void;
}

/**
 * What a host tells about the Claude sessions started in a terminal (#1596: a slice of the store):
 * a session follows `external.updated`, a permission request stays in the queue while it is open
 * and, when the window is not in front, reaches the person as a notification.
 */
export class ExternalSessionsSlice {
  constructor(private readonly core: ExternalSessionsCore) {}

  /** External sessions follow `external.updated`; requests stay in the queue while open. */
  onExternal(hostId: string, frame: ExternalUpdated | ExternalPermissionFrame): void {
    const state = this.core.state();
    if (frame.type === "external.updated") {
      const key = sessionKey(hostId, frame.session.claudeSessionId);
      const known = state.hosts.find((h) => h.id === hostId);
      if (known) {
        this.core.feedSession(
          { id: hostId, name: known.name },
          state.externals[key],
          frame.session,
        );
      }
      this.core.patch({
        externals: { ...state.externals, [key]: frame.session },
        // The name and pin of a terminal session ride on its frames (phase 10).
        ...(frame.session.meta ? { meta: { ...state.meta, [key]: frame.session.meta } } : {}),
      });
      this.tellWait(hostId, state.externals[key]?.waiting ?? null, frame.session);
      return;
    }
    const key = sessionKey(hostId, frame.requestId);
    const { [key]: _closed, ...open } = state.externalRequests;
    if (frame.state === "closed") {
      this.core.patch({ externalRequests: open });
      return;
    }
    this.core.patch({ externalRequests: { ...open, [key]: frame } });
    const host = state.hosts.find((h) => h.id === hostId);
    const cwd = state.externals[sessionKey(hostId, frame.claudeSessionId)]?.cwd;
    this.core.feedPermission({ id: hostId, name: host?.name ?? hostId }, frame, cwd ?? null);
    if (!this.core.isFocused()) {
      const project = this.core.projectOf(hostId, cwd);
      this.core.notify(
        externalRequestNotification(
          {
            hostId,
            hostName: host?.name ?? hostId,
            subject: this.title(hostId, frame.claudeSessionId),
            claudeSessionId: frame.claudeSessionId,
            toolName: frame.toolName,
            input: frame.input,
            link: requestLink(hostId, frame.requestId),
          },
          this.core.t(),
        ),
        undefined,
        undefined,
        {
          event: "needs-you",
          hostId,
          session: sessionKey(hostId, frame.claudeSessionId),
          ...(project ? { project } : {}),
        },
      );
    }
  }

  /**
   * A terminal session that now waits at a plan or a question it did not wait at before reaches the
   * person when the window is not in front (#1751). One whose hook holds the plan as a request is
   * told by that request.
   */
  private tellWait(hostId: string, before: ExternalSession["waiting"], session: ExternalSession) {
    const { claudeSessionId, waiting } = session;
    if (!waiting || waiting === before || this.core.isFocused()) return;
    const state = this.core.state();
    if (Object.values(state.externalRequests).some((r) => r.claudeSessionId === claudeSessionId)) {
      return;
    }
    const project = this.core.projectOf(hostId, session.cwd);
    this.core.notify(
      externalWaitNotification(
        {
          hostId,
          hostName: state.hosts.find((h) => h.id === hostId)?.name ?? hostId,
          subject: this.title(hostId, claudeSessionId),
          claudeSessionId,
          waiting,
        },
        this.core.t(),
      ),
      { name: "external", host: hostId, claudeSessionId },
      undefined,
      {
        event: "needs-you",
        hostId,
        session: sessionKey(hostId, claudeSessionId),
        ...(project ? { project } : {}),
      },
    );
  }

  /** A terminal session's name for a notification: the one given to it, else its folder or its id. */
  private title(hostId: string, claudeSessionId: string): string {
    const state = this.core.state();
    const key = sessionKey(hostId, claudeSessionId);
    const cwd = state.externals[key]?.cwd;
    return (
      state.meta[key]?.name ??
      state.hub[hostId]?.history.find((h) => h.claudeSessionId === claudeSessionId)?.title ??
      (cwd ? basename(cwd) : claudeSessionId.slice(0, 8))
    );
  }
}
