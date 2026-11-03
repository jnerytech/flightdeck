/**
 * Phase 36: what the person types that turns delivered work into money: hourly rates (the app's
 * default, a client's, a project's), the plan price, the review-time switch, and the people with
 * their limits. It lives in the app's own storage, beside the clients; a daemon never sees it.
 */
import type { Platform } from "../platform/types.ts";

export const ROI_KEY = "flightdeck.roi";

export interface Person {
  id: string;
  name: string;
  /** The hosts that are this person's. A host belongs to at most one person. */
  hostIds: string[];
  /** Monthly limits; null when the person has none. */
  tokenLimit: number | null;
  costLimit: number | null;
}

export interface RoiSettingsData {
  v: 1;
  defaultRate: number | null;
  clientRates: Record<string, number>;
  projectRates: Record<string, number>;
  planPrice: number | null;
  countReview: boolean;
  reviewCapMinutes: number;
  people: Person[];
}

export interface RoiSettingsOptions {
  newId?: () => string;
  onChange?: () => void;
}

export interface PersonInput {
  name: string;
  hostIds: string[];
  tokenLimit?: number | null;
  costLimit?: number | null;
}

export class RoiSettings {
  constructor(
    private readonly platform: Pick<Platform, "storage">,
    private readonly options: RoiSettingsOptions = {},
  ) {}

  data(): RoiSettingsData {
    void this.platform;
    void this.options;
    return {
      v: 1,
      defaultRate: 1,
      clientRates: {},
      projectRates: {},
      planPrice: 1,
      countReview: true,
      reviewCapMinutes: 0,
      people: [],
    };
  }

  setDefaultRate(_rate: number | null): void {}
  setClientRate(_clientId: string, _rate: number | null): void {}
  setProjectRate(_projectKey: string, _rate: number | null): void {}
  setPlanPrice(_price: number | null): void {}
  setCountReview(_on: boolean): void {}
  setReviewCap(_minutes: number): void {}

  /** The rate for a project: its own, else its client's, else the app's; null when none is set. */
  rateFor(_projectKey: string, _clientId: string | null): number | null {
    return 0;
  }

  addPerson(_input: PersonInput): Person {
    throw new Error("not implemented");
  }
  updatePerson(_id: string, _patch: Partial<PersonInput>): Person {
    throw new Error("not implemented");
  }
  removePerson(_id: string): void {}
  personOf(_hostId: string): Person | null {
    return { id: "", name: "", hostIds: [], tokenLimit: null, costLimit: null };
  }

  exportJson(): string {
    return "";
  }
  /** Replaces the rates and the switches and merges the people by id; null when the text is not an export. */
  importJson(_text: string): { people: number } | null {
    return { people: -1 };
  }
}
