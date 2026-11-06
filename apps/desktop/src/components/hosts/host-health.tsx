import type { DepResult, DepsResult, DoctorCheckResult, DoctorResult } from "@flightdeck/protocol";
import { Check, Copy, Minus, TriangleAlert, X } from "lucide-react";
import { useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { Panel } from "@/components/layout/panel";
import { Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import { formatAgo } from "../../i18n/format.ts";
import type { Key, T } from "../../i18n/index.ts";
import type { AppStore, HostView } from "../../lib/app-store.ts";
import {
  type DepLook,
  depLook,
  depsSummary,
  fixFor,
  fixNoteFor,
  fixPageFor,
} from "../../lib/deps-summary.ts";
import { ConfirmDialog } from "../../ui/ConfirmDialog.tsx";

const ICONS = { check: Check, warning: TriangleAlert, cross: X, dash: Minus } as const;
/** The colour of a tone, as whole class names so Tailwind finds them. */
function toneClass(tone: DepLook["tone"]): string {
  switch (tone) {
    case "ok":
      return "text-status-ok";
    case "warn":
      return "text-status-needs-you";
    case "error":
      return "text-status-error";
    default:
      return "text-status-ended";
  }
}

/** The dependency that already says what a doctor check says (the check is then shown once, as the dependency). */
const COVERED_BY: Record<string, string> = {
  claude: "claude",
  hooks: "hooks",
  folders: "folders",
  service: "service",
  linger: "service",
};

type Confirming = "hooks" | "update";

interface HealthRow {
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
interface RowEnv {
  t: T;
  os: string;
  update: string | null;
  onAddFolder(): void;
  confirm(what: Confirming): void;
}

/** The one-click fix a dependency row offers, when the app already has the action. */
function depAction(item: DepResult, lacking: boolean, env: RowEnv): HealthRow["action"] {
  if (!lacking) return null;
  if (item.id === "hooks")
    return { label: env.t("hostPage.install"), run: () => env.confirm("hooks") };
  if (item.id === "folders") return { label: env.t("hostHealth.addFolder"), run: env.onAddFolder };
  return null;
}

function depRow(item: DepResult, env: RowEnv): HealthRow {
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

function checkRow(check: DoctorCheckResult, env: RowEnv): HealthRow {
  const { t, update } = env;
  const offersUpdate = check.id === "version" && check.status !== "ok" && update !== null;
  return {
    key: check.id,
    name: t(`doctor.check.${check.id}` as Key),
    look: CHECK_LOOKS[check.status],
    word: t(CHECK_WORDS[check.status]),
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
function headlineFor(
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

/**
 * One section for what a host needs and how it is doing: its dependencies (required and optional)
 * and the checks the doctor makes, with the same icon and word on every row, and a one-click fix
 * where the app already has the action (hooks, the daemon update, the allowed folders). What needs
 * sudo or an installer is only copied: nothing here runs it.
 */
export function HostHealth(
  props: Readonly<{
    store: AppStore;
    host: HostView;
    deps: DepsResult | null;
    doctor: DoctorResult | null;
    /** When the health was read, in epoch milliseconds; null before the first read. */
    checkedAt: number | null;
    /** Why the last read failed, when it did. */
    error?: string | null;
    onCheck(): Promise<void>;
    /** "Add folder": the app takes the person to the allowed folders. */
    onAddFolder(): void;
    /** The hooks were installed from here: whoever shows their status asks again. */
    onHooksChanged(): void;
  }>,
) {
  const { store, host } = props;
  const { t } = store.i18n;
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const os = host.hostInfo?.os ?? "";
  const offer = host.hostInfo?.update;
  const update = offer?.available ? offer.version : null;
  const items = props.deps?.items ?? [];
  const have = new Set(items.map((item) => item.id as string));
  const checks = (props.doctor?.checks ?? []).filter((check) => {
    const covering = COVERED_BY[check.id];
    return covering === undefined || !have.has(covering);
  });

  const env: RowEnv = {
    t,
    os,
    update,
    onAddFolder: props.onAddFolder,
    confirm: setConfirming,
  };
  const rows = {
    required: items.filter((item) => item.group === "required").map((item) => depRow(item, env)),
    optional: items.filter((item) => item.group === "optional").map((item) => depRow(item, env)),
    checks: checks.map((check) => checkRow(check, env)),
  };
  const base = depsSummary(items);
  const failing = checks.filter((check) => check.status === "fail").length;
  const warning = checks.filter((check) => check.status === "warn").length;
  const required = (base.kind === "required" ? base.n : 0) + failing;
  const optional = (base.kind === "optional" ? base.n : 0) + warning;
  const { text: headline, look: headlineLook } = headlineFor(
    {
      error: props.error ?? null,
      read: props.deps !== null || props.doctor !== null,
      required,
      optional,
    },
    t,
  );
  const HeadIcon = ICONS[headlineLook.icon];

  const renderRow = (row: HealthRow) => {
    const Icon = ICONS[row.look.icon];
    return (
      <li key={row.key} aria-label={row.name} className="dep-row">
        <span className="dep-line">
          <Icon
            data-slot="dep-icon"
            data-icon={row.look.icon}
            aria-hidden="true"
            className={toneClass(row.look.tone)}
          />
          <strong>{row.name}</strong>
          <span className={toneClass(row.look.tone)}>{row.word}</span>
        </span>
        {row.found.length > 0 && <span className="dep-found">{row.found.join(" · ")}</span>}
        {row.breaks && <span className="text-sm">{row.breaks}</span>}
        {row.step && <span className="text-sm">{row.step}</span>}
        {(row.copy || row.page || row.action) && (
          <span className="dep-fix">
            {row.copy && (
              <>
                <code className="font-mono text-xs">{row.copy}</code>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  aria-label={t("hostDeps.copy", { name: row.name })}
                  onClick={() => void store.copyText(row.copy as string)}
                >
                  <Copy aria-hidden="true" />
                </Button>
              </>
            )}
            {row.page && (
              <Button
                variant="link"
                size="sm"
                aria-label={t("hostDeps.installPageFor", { name: row.name })}
                onClick={() => store.openLink(row.page as string)}
              >
                {t("hostDeps.installPage")}
              </Button>
            )}
            {row.action && (
              <Button variant="outline" size="sm" onClick={row.action.run}>
                {row.action.label}
              </Button>
            )}
          </span>
        )}
      </li>
    );
  };
  const group = (which: "required" | "optional" | "checks") =>
    rows[which].length === 0 ? null : (
      <Stack gap={2}>
        <h4 className="font-medium text-muted-foreground text-xs">
          {t(`hostHealth.groups.${which}` as Key)}
        </h4>
        <ul aria-label={t(`hostHealth.groups.${which}` as Key)} className="dep-list">
          {rows[which].map(renderRow)}
        </ul>
      </Stack>
    );

  return (
    <Panel title={t("hostHealth.title")} label={t("hostHealth.title")}>
      <output className="dep-line">
        <HeadIcon
          data-slot="dep-icon"
          aria-hidden="true"
          className={toneClass(headlineLook.tone)}
        />
        <strong>{headline}</strong>
      </output>
      {/* Outside the live region: the age changes every minute and must not be announced each time. */}
      {props.checkedAt !== null && (
        <span className="dep-found">
          {t("hostHealth.checked", {
            ago: formatAgo(Math.max(0, store.now() - props.checkedAt), t),
          })}
        </span>
      )}
      {group("required")}
      {group("optional")}
      {group("checks")}
      <div>
        <ActionButton variant="outline" size="sm" onClick={props.onCheck}>
          {t("hostDeps.check")}
        </ActionButton>
      </div>
      {confirming === "hooks" && (
        <ConfirmDialog
          message={t("hostPage.installMessage", { path: "~/.claude/settings.json" })}
          confirmLabel={t("hostPage.install")}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null);
            void store.hostCommand(host.id, "hooks.install", { confirm: true }).then(() => {
              props.onHooksChanged();
              return props.onCheck();
            });
          }}
        />
      )}
      {confirming === "update" && update && (
        <ConfirmDialog
          message={t("daemonUpdate.message", { host: host.name, version: update })}
          confirmLabel={t("daemonUpdate.confirm")}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null);
            void store.updateDaemon(host.id);
          }}
        />
      )}
    </Panel>
  );
}
