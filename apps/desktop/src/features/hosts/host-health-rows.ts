import type { DepResult, DoctorCheckResult } from "@flightdeck/protocol";
import type { Key, T } from "../../i18n/index.ts";
import {
  type DepLook,
  depLook,
  depsSummary,
  fixFor,
  fixNoteFor,
  fixPageFor,
} from "../../lib/deps-summary.ts";

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
    return { label: env.t("hostHealth.service.turnOn"), run: () => env.confirm("service") };
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
    breaks:
      lacking && item.breaks.length > 0
        ? t("hostDeps.without", {
            features: item.breaks.map((f) => t(`hostDeps.breaks.${f}` as Key)).join(", "),
          })
        : null,
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

/** The section's headline and its icon: a failed read, the first read pending, or what is missing. */
export function headlineFor(
  state: { error: string | null; read: boolean; required: number; optional: number },
  t: T,
): { text: string; look: DepLook } {
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
export function needsYou(row: HealthRow): boolean {
  return row.look.tone === "warn" || row.look.tone === "error";
}
