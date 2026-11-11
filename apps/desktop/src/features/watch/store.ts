import type {
  Card,
  CommandPayload,
  CommandResults,
  HostInfoResult,
  WatchInfo,
  WatchSettings,
} from "@flightdeck/protocol";
import type { T } from "../../i18n/index.ts";
import type { NotifySource } from "../../lib/notify-policy.ts";
import type { Route } from "../../lib/router.ts";
import { hasFeature } from "../../lib/version.ts";

/** The commands a card's watch and a PR link are made of. */
type WatchCommand =
  | "watch.get"
  | "watch.set"
  | "watch.extend"
  | "watch.resolveHeld"
  | "watch.byUrl"
  | "watch.settings"
  | "watch.describe"
  | "card.get";

/** What the PR watch reads and does through the app's store. */
export interface WatchCore {
  /** A command to a host; a refusal goes to the banner and gives null. `retry: false` for one that must not repeat. */
  command<C extends WatchCommand>(
    hostId: string,
    type: C,
    payload: CommandPayload<C>,
    options?: { retry?: boolean },
  ): Promise<CommandResults[C] | null>;
  /** The hosts, in the order the person added them. */
  hosts(): Array<{ id: string; name: string; status: string; hostInfo: HostInfoResult | null }>;
  /** The watch kept for a card, and the way to keep a new one. */
  watchOf(hostId: string, cardId: string): WatchInfo | undefined;
  keep(hostId: string, watch: WatchInfo): void;
  /** The card a watch is about, when the app has it. */
  card(hostId: string, cardId: string): Card | undefined;
  /** The webhook event of a watch that changed. */
  feed(
    host: { id: string; name: string },
    title: string,
    before: WatchInfo | undefined,
    watch: WatchInfo,
  ): void;
  /** The OS notification and the bell entry. */
  notify(
    notification: { title: string; body: string },
    route: Route | undefined,
    fallbackUrl: string | null | undefined,
    source: NotifySource,
  ): void;
  /** A failure for the person to read: the error, and the text to show instead of its message. */
  fail(error: unknown, text?: string): void;
  t(): T;
}

/**
 * The PR watch of the cards (#1596: a slice of the store): keeping a card's watch and telling the
 * OS when it starts to need the person, its commands (turn on or off, more rounds, a held round)
 * and the screen a PR link pasted in the palette belongs to.
 */
export class WatchSlice {
  constructor(private readonly core: WatchCore) {}

  /** Phase 22: keeps a card's watch; a card that starts to need you is told to the OS. */
  keep(hostId: string, watch: WatchInfo): void {
    const before = this.core.watchOf(hostId, watch.cardId);
    this.core.keep(hostId, watch);
    const host = this.core.hosts().find((h) => h.id === hostId);
    const card = this.core.card(hostId, watch.cardId);
    const title = card?.title ?? watch.cardId;
    this.core.feed({ id: hostId, name: host?.name ?? hostId }, title, before, watch);
    if (watch.status !== "needs_you" || before?.status === "needs_you") return;
    this.core.notify(
      { title: this.core.t()("watchUi.notifyTitle"), body: `${title}: ${watch.reason ?? ""}` },
      card ? { name: "card", host: hostId, projectId: card.projectId, cardId: card.id } : undefined,
      card?.prUrl,
      {
        event: "pr-watch",
        hostId,
        ...(card ? { project: `${hostId}/${card.projectId}` } : {}),
      },
    );
  }

  /** Phase 22: reads a card's watch from its host. */
  async load(hostId: string, cardId: string): Promise<void> {
    const watch = await this.core.command(hostId, "watch.get", { cardId });
    if (watch) this.keep(hostId, watch);
  }

  /** Phase 22: turns the watch of a card's PR on or off (`null`: the project's default). */
  async set(hostId: string, cardId: string, enabled: boolean | null): Promise<void> {
    const watch = await this.core.command(hostId, "watch.set", { cardId, enabled });
    if (watch) this.keep(hostId, watch);
  }

  /** Issue #77: the person allows a card's watch `rounds` more fixing rounds. */
  async extend(hostId: string, cardId: string, rounds: number): Promise<void> {
    // A refusal (no watch, another limit) would come back: nothing to retry.
    const watch = await this.core.command(
      hostId,
      "watch.extend",
      { cardId, rounds },
      { retry: false },
    );
    if (watch) this.keep(hostId, watch);
  }

  /** Issue #77: a round held for drift, pushed as it is or dropped. */
  async resolveHeld(
    hostId: string,
    cardId: string,
    roundId: string,
    action: "push" | "drop",
  ): Promise<void> {
    // Repeated later, a push or drop would act on a round that may be settled already.
    const watch = await this.core.command(
      hostId,
      "watch.resolveHeld",
      { cardId, roundId, action },
      { retry: false },
    );
    if (watch) this.keep(hostId, watch);
  }

  /**
   * Phase 22: a project's PR watch settings, with `patch` changed first when given. The host's
   * settings after it, or null when it refuses (the toast says why).
   */
  settings(hostId: string, projectId: string, patch?: Partial<WatchSettings>) {
    return this.core.command(hostId, "watch.settings", { projectId, ...(patch ? { patch } : {}) });
  }

  /** Phase 22: the PR description made from the card's sessions, for the person to edit. */
  describe(hostId: string, cardId: string) {
    return this.core.command(hostId, "watch.describe", { cardId });
  }

  /**
   * Phase 22: the screen of a PR link pasted in the palette: the card it belongs to, or else the
   * first session the history knows for it. The hosts that watch PRs are asked in order; when
   * none knows it, a toast says so and the answer is null.
   */
  async openLink(url: string): Promise<Route | null> {
    for (const host of this.core.hosts()) {
      if (host.status !== "online" || !hasFeature(host.hostInfo?.features, "watch", false))
        continue;
      const found = await this.core.command(host.id, "watch.byUrl", { url }); // NOSONAR: hosts are asked in order and the first that knows the address wins
      if (found?.via === "card" && found.trace) {
        const card = await this.core.command(host.id, "card.get", { cardId: found.trace.cardId }); // NOSONAR: hosts are asked in order and the first that knows the address wins
        if (card) {
          return { name: "card", host: host.id, projectId: card.projectId, cardId: card.id };
        }
      }
      const session = found?.sessions[0];
      if (session) {
        return {
          name: "reader",
          target: { hostId: host.id, claudeSessionId: session.claudeSessionId },
        };
      }
    }
    const text = this.core.t()("palette.noPrMatch");
    this.core.fail(new Error(text), text);
    return null;
  }
}
