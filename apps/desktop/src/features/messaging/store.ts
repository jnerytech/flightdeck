import type { CommandResults, MessagingAlertFrame } from "@flightdeck/protocol";
import { byCodeUnit } from "@flightdeck/protocol";
import type { T } from "../../i18n/index.ts";

/** Phase 21: a pair of sessions a host paused because they kept answering each other. */
export interface LoopAlert {
  hostId: string;
  from: string;
  to: string;
  message: string;
  at: string;
}

/** The daemon's key for a pair of sessions, the same in both directions. */
export const loopPairKey = (alert: Pick<LoopAlert, "from" | "to">): string =>
  [alert.from, alert.to].sort(byCodeUnit).join("|");

/** The messaging's part of the app's state (#1596): for now, the loops a host paused. */
export interface MessagingSliceState {
  /** Phase 21: the pairs a host paused for a loop, waiting in "Precisa de você" to be freed. */
  loopAlerts: LoopAlert[];
}

/** A fresh initial state for each store: its arrays are never shared between stores. */
export const initialMessagingState = (): MessagingSliceState => ({ loopAlerts: [] });

/** What the messaging reads and asks through the app's store. */
export interface MessagingCore {
  state(): MessagingSliceState;
  update(patch: Partial<MessagingSliceState>): void;
  /** The host's messaging rules; null when it refuses (the toast says why). */
  rules(hostId: string): Promise<CommandResults["messaging.rules.get"] | null>;
  /** Writes the host's messaging policy and unpauses `unpause`; null when it refuses. */
  setRules(
    hostId: string,
    rules: { policy: Record<string, unknown>; unpause: string[] },
  ): Promise<CommandResults["messaging.rules.set"] | null>;
  /** The OS notification and the bell entry. */
  notify(notification: { title: string; body: string }): void;
  t(): T;
}

/** The messages between sessions of the hosts (phase 21; #1596: a slice of the store). */
export class MessagingSlice {
  constructor(private readonly core: MessagingCore) {}

  /** Phase 21: a paused loop waits in "Precisa de você" (once per pair) and the OS shows it. */
  onLoopAlert(hostId: string, frame: MessagingAlertFrame): void {
    const alert: LoopAlert = {
      hostId,
      from: frame.from,
      to: frame.to,
      message: frame.message,
      at: frame.at,
    };
    const others = this.core
      .state()
      .loopAlerts.filter((a) => a.hostId !== hostId || loopPairKey(a) !== loopPairKey(alert));
    this.core.update({ loopAlerts: [...others, alert] });
    this.core.notify({ title: this.core.t()("needsYou.loopTitle"), body: frame.message });
  }

  /**
   * Phase 21: frees a paused pair (its `loopPairKey`), keeping the host's messaging policy as it
   * is; its entry in "Precisa de você" goes too. The host's rules after it, or null on failure.
   */
  async releasePair(
    hostId: string,
    key: string,
  ): Promise<CommandResults["messaging.rules.set"] | null> {
    const rules = await this.core.rules(hostId);
    if (!rules) return null;
    const done = await this.core.setRules(hostId, { policy: rules.policy, unpause: [key] });
    if (!done) return null;
    this.core.update({
      loopAlerts: this.core
        .state()
        .loopAlerts.filter((a) => a.hostId !== hostId || loopPairKey(a) !== key),
    });
    return done;
  }
}
