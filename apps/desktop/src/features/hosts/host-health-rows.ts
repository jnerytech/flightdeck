import type { DepResult, DoctorCheckResult } from "@flightdeck/protocol";
import type { T } from "../../i18n/index.ts";
import type { DepLook } from "../../lib/deps-summary.ts";

export type Confirming = "hooks" | "update" | "service";

export interface HealthRow {
  key: string;
  name: string;
  look: DepLook;
  word: string;
  found: string[];
  breaks: string | null;
  /** What to do by hand: a command to copy, or a plain step. */
  copy: string | null;
  /** The official install page, opened in the browser. */
  page: string | null;
  step: string | null;
  action: { label: string; run(): void } | null;
}

/** What a row builder needs from the component. */
export interface RowEnv {
  t: T;
  os: string;
  update: string | null;
  onAddFolder(): void;
  confirm(what: Confirming): void;
  /** #1200: the host is connected and can install itself as a service from here. */
  canInstallService: boolean;
}

export function depRow(item: DepResult, _env: RowEnv): HealthRow {
  return {
    key: "",
    name: "",
    look: { icon: "dash", tone: "off" },
    word: "",
    found: [],
    breaks: null,
    copy: null,
    page: null,
    step: item.id,
    action: null,
  };
}

export function checkRow(check: DoctorCheckResult, _env: RowEnv): HealthRow {
  return depRow({ id: check.id } as unknown as DepResult, _env);
}

export function headlineFor(
  _state: { error: string | null; read: boolean; required: number; optional: number },
  _t: T,
): { text: string; look: DepLook } {
  return { text: "", look: { icon: "dash", tone: "off" } };
}

/** The doctor checks a dependency row does not already say. */
export function uncoveredChecks(
  checks: DoctorCheckResult[],
  _items: DepResult[],
): DoctorCheckResult[] {
  return checks;
}

/** What the headline counts: the missing required and optional, from the dependencies and the doctor. */
export function healthCounts(
  _items: DepResult[],
  _checks: DoctorCheckResult[],
): { required: number; optional: number } {
  return { required: -1, optional: -1 };
}

/** A row needs the person when it warns or fails; the rest are folded (#640). */
export function needsYou(_row: HealthRow): boolean {
  return false;
}
