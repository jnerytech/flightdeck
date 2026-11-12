import type { InterruptedSession } from "@flightdeck/protocol";
import { basename } from "@/shared/lib/index.ts";
import type { T } from "../../i18n/index.ts";
import type { HostConnection } from "../../lib/host-connection.ts";
import type { Platform } from "../../platform/types.ts";
import {
  CONTINUATION,
  loadAutoResume,
  loadHandled,
  markHandled,
  offerKey,
  saveAutoResume,
  unanswered,
} from "./resume-offer.ts";

/** The offer to resume a host's interrupted sessions: shown (open) or put off for the host page. */
export interface ResumeOffer {
  sessions: InterruptedSession[];
  open: boolean;
  /** The ones already resumed from this offer: they stay listed, as "Resumed", while it is open. */
  resumed: string[];
}

/** The sessions' part of the app's state (#1596): for now, the offers to resume interrupted ones. */
export interface SessionsSliceState {
  /** The sessions a daemon restart interrupted on each host, offered for resume (issue #150). */
  resumeOffers: Record<string, ResumeOffer>;
}

/** A fresh initial state for each store: its records are never shared between stores. */
export const initialSessionsState = (): SessionsSliceState => ({ resumeOffers: {} });

/** What the sessions read and write through the app's store. */
export interface SessionsCore {
  state(): SessionsSliceState;
  update(patch: Partial<SessionsSliceState>): void;
  /** Where the answered offers and the auto-resume choice are kept. */
  storage: Platform["storage"];
  /** A host's live connection; absent when it is not connected. */
  connection(hostId: string): Pick<HostConnection, "request"> | undefined;
  /** The app's texts in the current language. */
  t(): T;
  success(text: string): void;
}

/** The sessions a restart interrupted, and the offer to resume them (issue #150; #1596: a slice). */
export class SessionsSlice {
  constructor(private readonly core: SessionsCore) {}

  /** Whether this app resumes the sessions a restart interrupted on this host by itself (issue #150). */
  autoResume(hostId: string): boolean {
    return loadAutoResume(this.core.storage, hostId);
  }

  setAutoResume(hostId: string, on: boolean): void {
    saveAutoResume(this.core.storage, hostId, on);
    this.core.update({});
  }

  /**
   * Looks for the sessions a restart interrupted: the dialog, or (auto) the resume itself. Only
   * the store calls it, when a host with the feature connects; a screen never does.
   */
  async offerResume(hostId: string, conn: Pick<HostConnection, "request">): Promise<void> {
    const found = await conn.request("session.interrupted", {}).catch(() => null);
    const pending = unanswered(found?.sessions ?? [], loadHandled(this.core.storage)[hostId]);
    if (pending.length === 0) {
      // Everything is answered: a put-off offer stays reachable, until the daemon has nothing to offer.
      if ((found?.sessions ?? []).length === 0) this.dropOffer(hostId);
      return;
    }
    if (this.autoResume(hostId)) {
      const done = await this.resumeInterrupted(hostId, pending);
      const names = pending
        .filter((s) => done[s.sessionId]?.ok)
        .map((s) => s.name ?? basename(s.cwd));
      if (names.length > 0) {
        const t = this.core.t();
        this.core.success(
          t(names.length === 1 ? "resumeOffer.autoOne" : "resumeOffer.autoMany", {
            n: names.length,
            names: names.join(", "),
          }),
        );
      }
      return;
    }
    this.core.update({
      resumeOffers: {
        ...this.core.state().resumeOffers,
        [hostId]: { sessions: pending, open: true, resumed: [] },
      },
    });
  }

  private dropOffer(hostId: string): void {
    if (!(hostId in this.core.state().resumeOffers)) return;
    const { [hostId]: _gone, ...rest } = this.core.state().resumeOffers;
    this.core.update({ resumeOffers: rest });
  }

  /**
   * Resumes these sessions one by one (each goes through the normal resume, so the daemon's own
   * rules apply) and tells each one to continue; never the original request again.
   */
  async resumeInterrupted(
    hostId: string,
    sessions: InterruptedSession[],
  ): Promise<Record<string, { ok: true } | { ok: false; reason: string }>> {
    const conn = this.core.connection(hostId);
    const result: Record<string, { ok: true } | { ok: false; reason: string }> = {};
    for (const session of sessions) {
      try {
        if (!conn) throw new Error("offline");
        await conn.request("session.resume", { sessionId: session.sessionId }); // NOSONAR: sequential by design: a session is resumed before it is sent to, one session at a time
        await conn.request("session.send", { sessionId: session.sessionId, text: CONTINUATION }); // NOSONAR: sequential by design: the continuation goes only after the resume answered
        result[session.sessionId] = { ok: true };
        markHandled(this.core.storage, hostId, [offerKey(session)]);
      } catch (error) {
        result[session.sessionId] = {
          ok: false,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    }
    const offer = this.core.state().resumeOffers[hostId];
    if (offer) {
      const resumed = [
        ...new Set([
          ...offer.resumed,
          ...sessions.filter((s) => result[s.sessionId]?.ok).map((s) => s.sessionId),
        ]),
      ];
      this.core.update({
        resumeOffers: { ...this.core.state().resumeOffers, [hostId]: { ...offer, resumed } },
      });
    }
    return result;
  }

  /** "Not now": the dialog goes, the offer stays reachable from the host page, and it does not come back by itself. */
  snoozeResumeOffer(hostId: string): void {
    const offer = this.core.state().resumeOffers[hostId];
    if (!offer) return;
    markHandled(this.core.storage, hostId, offer.sessions.map(offerKey));
    this.core.update({
      resumeOffers: { ...this.core.state().resumeOffers, [hostId]: { ...offer, open: false } },
    });
  }

  openResumeOffer(hostId: string): void {
    const offer = this.core.state().resumeOffers[hostId];
    if (offer)
      this.core.update({
        resumeOffers: { ...this.core.state().resumeOffers, [hostId]: { ...offer, open: true } },
      });
  }

  /** "Dismiss all": the offer is gone for good. */
  dismissResumeOffer(hostId: string): void {
    const offer = this.core.state().resumeOffers[hostId];
    if (offer) markHandled(this.core.storage, hostId, offer.sessions.map(offerKey));
    this.dropOffer(hostId);
  }
}
