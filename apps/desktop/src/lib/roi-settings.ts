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

/** A refusal with a reason the app tells in its language. */
export class RoiSettingsError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

const MAX_AMOUNT = 1_000_000;
/** A token limit is a count, and counts get big. */
const MAX_TOKENS = 1_000_000_000_000;

const empty = (): RoiSettingsData => ({
  v: 1,
  defaultRate: null,
  clientRates: {},
  projectRates: {},
  planPrice: null,
  countReview: false,
  reviewCapMinutes: 5,
  people: [],
});

const amount = (
  value: number | null | undefined,
  reason: string,
  max = MAX_AMOUNT,
): number | null => {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0 || value > max) throw new RoiSettingsError(reason);
  return value;
};

const isAmount = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_AMOUNT;
const orNull = (v: unknown): v is number | null => v === null || isAmount(v);
const orNullTokens = (v: unknown): v is number | null =>
  v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_TOKENS);
const isRates = (v: unknown): v is Record<string, number> =>
  typeof v === "object" && v !== null && !Array.isArray(v) && Object.values(v).every(isAmount);

function isPerson(v: unknown): v is Person {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.id === "string" &&
    typeof p.name === "string" &&
    Array.isArray(p.hostIds) &&
    p.hostIds.every((h) => typeof h === "string") &&
    orNullTokens(p.tokenLimit) &&
    orNull(p.costLimit)
  );
}

/** The data when `raw` is a whole, valid one; null otherwise. */
function parse(raw: unknown): RoiSettingsData | null {
  if (typeof raw !== "object" || raw === null) return null;
  const d = raw as Record<string, unknown>;
  const cap = d.reviewCapMinutes;
  if (
    d.v !== 1 ||
    !orNull(d.defaultRate) ||
    !isRates(d.clientRates) ||
    !isRates(d.projectRates) ||
    !orNull(d.planPrice) ||
    typeof d.countReview !== "boolean" ||
    typeof cap !== "number" ||
    !(cap >= 1 && cap <= 60) ||
    !Array.isArray(d.people) ||
    !d.people.every(isPerson)
  ) {
    return null;
  }
  return {
    v: 1,
    defaultRate: d.defaultRate,
    clientRates: d.clientRates,
    projectRates: d.projectRates,
    planPrice: d.planPrice,
    countReview: d.countReview,
    reviewCapMinutes: cap,
    people: d.people,
  };
}

export class RoiSettings {
  constructor(
    private readonly platform: Pick<Platform, "storage">,
    private readonly options: RoiSettingsOptions = {},
  ) {}

  data(): RoiSettingsData {
    try {
      return parse(JSON.parse(this.platform.storage.getItem(ROI_KEY) ?? "null")) ?? empty();
    } catch {
      return empty();
    }
  }

  private write(data: RoiSettingsData): void {
    this.platform.storage.setItem(ROI_KEY, JSON.stringify(data));
    this.options.onChange?.();
  }

  setDefaultRate(rate: number | null): void {
    this.write({ ...this.data(), defaultRate: amount(rate, "rate_invalid") });
  }

  setClientRate(clientId: string, rate: number | null): void {
    const data = this.data();
    const value = amount(rate, "rate_invalid");
    const { [clientId]: _gone, ...rest } = data.clientRates;
    this.write({ ...data, clientRates: value === null ? rest : { ...rest, [clientId]: value } });
  }

  setProjectRate(projectKey: string, rate: number | null): void {
    const data = this.data();
    const value = amount(rate, "rate_invalid");
    const { [projectKey]: _gone, ...rest } = data.projectRates;
    this.write({ ...data, projectRates: value === null ? rest : { ...rest, [projectKey]: value } });
  }

  setPlanPrice(price: number | null): void {
    this.write({ ...this.data(), planPrice: amount(price, "price_invalid") });
  }

  setCountReview(on: boolean): void {
    this.write({ ...this.data(), countReview: on });
  }

  setReviewCap(minutes: number): void {
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 60) {
      throw new RoiSettingsError("review_cap_invalid");
    }
    this.write({ ...this.data(), reviewCapMinutes: minutes });
  }

  /** The rate for a project: its own, else its client's, else the app's; null when none is set. */
  rateFor(projectKey: string, clientId: string | null): number | null {
    const data = this.data();
    return (
      data.projectRates[projectKey] ??
      (clientId === null ? undefined : data.clientRates[clientId]) ??
      data.defaultRate
    );
  }

  /** The person, checked against the others: a name once, a host in one person only. */
  private checked(input: PersonInput, others: Person[]): Omit<Person, "id"> {
    const name = input.name.trim();
    if (name === "") throw new RoiSettingsError("person_name_empty");
    if (others.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      throw new RoiSettingsError("person_name_taken");
    }
    const hostIds = [...new Set(input.hostIds)];
    if (hostIds.some((h) => others.some((p) => p.hostIds.includes(h)))) {
      throw new RoiSettingsError("person_host_taken");
    }
    return {
      name,
      hostIds,
      tokenLimit: amount(input.tokenLimit, "person_limit_invalid", MAX_TOKENS),
      costLimit: amount(input.costLimit, "person_limit_invalid"),
    };
  }

  addPerson(input: PersonInput): Person {
    const data = this.data();
    const person: Person = {
      id: (this.options.newId ?? (() => crypto.randomUUID()))(),
      ...this.checked(input, data.people),
    };
    this.write({ ...data, people: [...data.people, person] });
    return person;
  }

  updatePerson(id: string, patch: Partial<PersonInput>): Person {
    const data = this.data();
    const current = data.people.find((p) => p.id === id);
    if (!current) throw new RoiSettingsError("person_not_found");
    const next: Person = {
      id,
      ...this.checked(
        {
          name: patch.name ?? current.name,
          hostIds: patch.hostIds ?? current.hostIds,
          tokenLimit: patch.tokenLimit === undefined ? current.tokenLimit : patch.tokenLimit,
          costLimit: patch.costLimit === undefined ? current.costLimit : patch.costLimit,
        },
        data.people.filter((p) => p.id !== id),
      ),
    };
    this.write({ ...data, people: data.people.map((p) => (p.id === id ? next : p)) });
    return next;
  }

  removePerson(id: string): void {
    const data = this.data();
    this.write({ ...data, people: data.people.filter((p) => p.id !== id) });
  }

  personOf(hostId: string): Person | null {
    return this.data().people.find((p) => p.hostIds.includes(hostId)) ?? null;
  }

  exportJson(): string {
    return JSON.stringify(this.data());
  }

  /** Replaces the rates and the switches and merges the people by id; null when the text is not an export. */
  importJson(text: string): { people: number } | null {
    let incoming: RoiSettingsData | null;
    try {
      incoming = parse(JSON.parse(text));
    } catch {
      return null;
    }
    if (!incoming) return null;
    const data = this.data();
    const people = [...data.people];
    let added = 0;
    for (const person of incoming.people) {
      const same = people.findIndex((p) => p.id === person.id && p.name === person.name);
      if (same >= 0) {
        people[same] = person;
        continue;
      }
      const clash =
        people.some((p) => p.name.toLowerCase() === person.name.toLowerCase()) ||
        person.hostIds.some((h) => people.some((p) => p.hostIds.includes(h)));
      if (clash) continue;
      const id = people.some((p) => p.id === person.id)
        ? (this.options.newId ?? (() => crypto.randomUUID()))()
        : person.id;
      people.push({ ...person, id });
      added += 1;
    }
    this.write({ ...incoming, people });
    return { people: added };
  }
}
