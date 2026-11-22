import type { DepResult, DoctorCheckResult } from "@flightdeck/protocol";
import type { Key, T } from "../../../i18n/index.ts";
import {
  type DepLook,
  depBreaksText,
  depLook,
  depsSummary,
  fixFor,
  fixNoteFor,
  fixPageFor,
} from "../../deps/index.ts";

/** The dependency that already says what a doctor check says (the check is then shown once, as the dependency). */
const COVERED_BY: Record<string, string> = {
  claude: "claude",
  hooks: "hooks",
  folders: "folders",
  service: "service",
  linger: "service",
};

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

/** The one-click fix a dependency row offers, when the app already has the action. */
function depAction(item: DepResult, lacking: boolean, env: RowEnv): HealthRow["action"] {
  if (!lacking) return null;
  if (item.id === "hooks")
    return { label: env.t("hostPage.install"), run: () => env.confirm("hooks") };
  if (item.id === "folders") return { label: env.t("hostHealth.addFolder"), run: env.onAddFolder };
  // #1200: only the install itself; the linger line needs sudo and stays a command to copy.
  if (
    item.id === "service" &&
    env.canInstallService &&
    item.fix.some((fix) => fix.command === "flightdeckd service install")
  ) {
    return { label: env.t("hostHealth.service.turnOnRow"), run: () => env.confirm("service") };
  }
  return null;
}

export function depRow(item: DepResult, env: RowEnv): HealthRow {
  const { t, os } = env;
  const lacking = item.state === "missing" || item.state === "outdated";
  const note = lacking ? fixNoteFor(item, os) : null;
  return {
    key: item.id,
    name: t(`hostDeps.names.${item.id}` as Key),
    look: depLook(item),
    word: t(`hostDeps.state.${item.state}` as Key),
    found: [
      item.version ? t("hostDeps.version", { version: item.version }) : null,
      item.minVersion ? t("hostDeps.minVersion", { version: item.minVersion }) : null,
      item.path ?? null,
    ].filter((part): part is string => part !== null),
    breaks: lacking ? depBreaksText(item, t) : null,
    copy: lacking ? fixFor(item, os) : null,
    page: lacking ? fixPageFor(item, os) : null,
    step: note ? t(`hostDeps.fixNote.${note}` as Key) : null,
    action: depAction(item, lacking, env),
  };
}

const CHECK_LOOKS: Record<DoctorCheckResult["status"], DepLook> = {
  ok: { icon: "check", tone: "ok" },
  warn: { icon: "warning", tone: "warn" },
  fail: { icon: "cross", tone: "error" },
};
const CHECK_WORDS: Record<DoctorCheckResult["status"], Key> = {
  ok: "hostDeps.state.ok",
  warn: "hostHealth.warning",
  fail: "hostHealth.failed",
};

export function checkRow(check: DoctorCheckResult, env: RowEnv): HealthRow {
  const { t, update } = env;
  const offersUpdate = check.id === "version" && check.status !== "ok" && update !== null;
  // An optional tool that is not installed passed, but it is not "OK": it is muted (#670).
  const absent = check.absent === true;
  return {
    key: check.id,
    name: t(`doctor.check.${check.id}` as Key),
    look: absent ? { icon: "dash", tone: "off" } : CHECK_LOOKS[check.status],
    word: t(absent ? "hostHealth.optionalAbsent" : CHECK_WORDS[check.status]),
    found: [check.detail],
    breaks: null,
    copy: null,
    page: null,
    step:
      check.status === "ok"
        ? null
        : t("doctor.fix", { step: t(`doctor.steps.${check.id}` as Key) }),
    action: offersUpdate
      ? { label: t("daemonUpdate.button", { version: update }), run: () => env.confirm("update") }
      : null,
  };
}

/** The section's headline and its icon: an offline host, a failed read, the first read pending, or what is missing. */
export function headlineFor(
  state: {
    error: string | null;
    offline: boolean;
    read: boolean;
    required: number;
    optional: number;
  },
  t: T,
): { text: string; look: DepLook } {
  if (state.offline) return { text: t("hostDeps.offline"), look: { icon: "dash", tone: "off" } };
  if (state.error) {
    return {
      text: t("hostDeps.readFailed", { reason: state.error }),
      look: { icon: "warning", tone: "warn" },
    };
  }
  if (!state.read) return { text: t("hostDeps.checking"), look: { icon: "dash", tone: "off" } };
  if (state.required > 0) {
    return {
      text: t("hostDeps.requiredMissing", { n: state.required }),
      look: { icon: "cross", tone: "error" },
    };
  }
  if (state.optional > 0) {
    return {
      text: t("hostDeps.optionalMissing", { n: state.optional }),
      look: { icon: "warning", tone: "warn" },
    };
  }
  return { text: t("hostDeps.allSet"), look: { icon: "check", tone: "ok" } };
}

/** What the rows say, in one string: two reads with the same signature found the same thing. */
export function signatureOf(items: DepResult[], checks: DoctorCheckResult[]): string {
  return [
    ...items.map((item) => `${item.id}:${item.state}:${item.version ?? ""}:${item.path ?? ""}`),
    ...checks.map((check) => `${check.id}:${check.status}:${check.detail}`),
  ]
    .sort((a, b) => a.localeCompare(b))
    .join("|");
}

/** What Check again or a fix was asked at, kept to tell its answer apart (#4323, #4324). */
export interface Asked {
  before: string;
  /** The row a one-click fix was for; null for Check again. */
  fix: "hooks" | "service" | null;
  /** The name of that row, kept in case the next read no longer lists it. */
  name: string;
  /** The read time when it was asked: a newer one is the answer. */
  at: number | null;
  /** The answer, once the first newer read gave it: later reads do not rewrite it. */
  answer: string | null;
}

/** The answer to Check again or a fix, in words; null until a newer read arrives or when the read failed. */
export function resultFor(
  asked: Asked | null,
  now: { signature: string; checkedAt: number | null; error: string | null },
  rows: HealthRow[],
  t: T,
): string | null {
  if (!asked || now.checkedAt === asked.at || now.error) return null;
  const fixed = asked.fix ? rows.find((row) => row.key === asked.fix) : undefined;
  if (asked.fix) {
    const key = fixed && needsYou(fixed) ? "hostHealth.fixedStill" : "hostHealth.fixed";
    return t(key, { name: fixed?.name ?? asked.name });
  }
  return t(now.signature === asked.before ? "hostHealth.resultSame" : "hostHealth.resultChanged");
}

/** The doctor checks a dependency row does not already say. */
export function uncoveredChecks(
  checks: DoctorCheckResult[],
  items: DepResult[],
): DoctorCheckResult[] {
  const have = new Set(items.map((item) => item.id as string));
  return checks.filter((check) => {
    const covering = COVERED_BY[check.id];
    return covering === undefined || !have.has(covering);
  });
}

/** What the headline counts: the missing required and optional, from the dependencies and the doctor. */
export function healthCounts(
  items: DepResult[],
  checks: DoctorCheckResult[],
): { required: number; optional: number } {
  const base = depsSummary(items);
  const failing = checks.filter((check) => check.status === "fail").length;
  const warning = checks.filter((check) => check.status === "warn").length;
  return {
    required: (base.kind === "required" ? base.n : 0) + failing,
    optional: (base.kind === "optional" ? base.n : 0) + warning,
  };
}

/** A row needs the person when it warns or fails; the rest are folded (#640). */
export function needsYou(row: Pick<HealthRow, "look">): boolean {
  return row.look.tone === "warn" || row.look.tone === "error";
}
