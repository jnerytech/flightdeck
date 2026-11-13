import type { RoiSummaryResult } from "@flightdeck/protocol";
import type { AppState, HostResult } from "../../lib/app-store.ts";
import { hostsWith } from "../../lib/version.ts";
import type { RoiMoney } from "./domain/roi.ts";
import type { RoiSettings } from "./domain/roi-settings.ts";

/** What the ROI reads and asks through the app's store. */
export interface RoiCore {
  /** The hosts the app knows. */
  hosts(): AppState["hosts"];
  /** Milliseconds now. */
  now(): number;
  /** A host's `roi.summary`, its refusal coming back as a result instead of a banner. */
  summary(
    hostId: string,
    range: { from: string; to: string },
  ): Promise<HostResult<RoiSummaryResult>>;
  /** The client a project belongs to, or null when it has none. */
  clientOf(projectKey: string): string | null;
  /** The rates, the plan price and the people kept by the app. */
  settings(): RoiSettings;
}

/**
 * The return on the work (#1596: a slice of the store): the day the figures end on, what each host
 * says for a range of days, and what the person typed that turns a project's work into money.
 */
export class RoiSlice {
  constructor(private readonly core: RoiCore) {}

  /**
   * Phase 36: the day the hosts' ROI figures end on. A host dates a delivery by its UTC day, so
   * the range ends on today's UTC day: west of Greenwich, late in the evening, the local day is
   * still yesterday and today's work would fall outside it.
   */
  today(): string {
    return new Date(this.core.now()).toISOString().slice(0, 10);
  }

  /**
   * Phase 36: each online host's `roi.summary` for the days given. A host without the feature, or
   * that cannot be reached, is left out; the card says how many answered.
   */
  async summaries(
    from: string,
    to: string,
  ): Promise<Array<{ hostId: string; result: RoiSummaryResult }>> {
    const hosts = hostsWith(this.core.hosts(), "roi");
    const answers = await Promise.all(
      hosts.map(async (host) => ({
        hostId: host.id,
        asked: await this.core.summary(host.id, { from, to }),
      })),
    );
    return answers.flatMap(({ hostId, asked }) =>
      asked.ok ? [{ hostId, result: asked.data }] : [],
    );
  }

  /** Phase 36: what the person typed that turns the work of a project into money. */
  moneyOf(projectKey: string): RoiMoney {
    const settings = this.core.settings();
    const data = settings.data();
    return {
      rate: settings.rateFor(projectKey, this.core.clientOf(projectKey)),
      billed: null,
      planShareUsd: null,
      countReview: data.countReview,
      reviewCapSeconds: data.reviewCapMinutes * 60,
    };
  }
}
