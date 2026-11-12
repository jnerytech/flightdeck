import type { TeamInfo, TeamsUpdatedFrame } from "@flightdeck/protocol";
import type { T } from "../../i18n/index.ts";

/** What the teams read and ask through the app's store. */
export interface TeamsCore {
  /** Keeps the team's sessions, so the workers' notifications can be folded. */
  remember(hostId: string, team: TeamInfo): void;
  /** The OS notification and the bell entry, opening the team. */
  notify(
    notification: { title: string; body: string },
    route: { name: "teams"; host: string; team: string },
  ): void;
  t(): T;
}

/** The teams of the hosts (#1596: a slice of the store): their changes, told and notified. */
export class TeamsSlice {
  private readonly listeners = new Set<(hostId: string, frame: TeamsUpdatedFrame) => void>();

  constructor(private readonly core: TeamsCore) {}

  /** A team changed on a host: kept, told to the page, and, when it is news, notified. */
  onFrame(hostId: string, frame: TeamsUpdatedFrame): void {
    this.core.remember(hostId, frame.team);
    for (const listener of this.listeners) listener(hostId, frame);
    // #1220: the coordinator reported the goal done; the host sends it once per final report.
    const t = this.core.t();
    const body = frame.event === "report_done" ? t("teamsUi.reportDone") : frame.reason;
    if (body) {
      this.core.notify(
        { title: t("teamsUi.notifyTitle", { name: frame.team.name }), body },
        { name: "teams", host: hostId, team: frame.team.id },
      );
    }
  }

  /** Told each time a team changes on a host. */
  onUpdated(listener: (hostId: string, frame: TeamsUpdatedFrame) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
