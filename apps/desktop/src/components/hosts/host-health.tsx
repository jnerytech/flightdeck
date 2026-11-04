import type { DepResult, DepsResult, DoctorCheckResult, DoctorResult } from "@flightdeck/protocol";
import { Check, Copy, Minus, TriangleAlert, X } from "lucide-react";
import { useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { Panel } from "@/components/layout/panel";
import { Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import { formatAgo } from "../../i18n/format.ts";
import type { Key } from "../../i18n/index.ts";
import type { AppStore, HostView } from "../../lib/app-store.ts";
import { type DepLook, depLook, depsSummary, fixFor, fixPageFor } from "../../lib/deps-summary.ts";
import { ConfirmDialog } from "../../ui/ConfirmDialog.tsx";

const ICONS = { check: Check, warning: TriangleAlert, cross: X, dash: Minus } as const;
// Whole class names, so Tailwind finds them.
const TONES: Record<DepLook["tone"], string> = {
  ok: "text-status-ok",
  warn: "text-status-needs-you",
  error: "text-status-error",
  off: "text-status-ended",
};

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

/**
 * One section for what a host needs and how it is doing: its dependencies (required and optional)
 * and the checks the doctor makes, with the same icon and word on every row, and a one-click fix
 * where the app already has the action (hooks, the daemon update, the allowed folders). What needs
 * sudo or an installer is only copied: nothing here runs it.
 */
export function HostHealth(props: {
  store: AppStore;
  host: HostView;
  deps: DepsResult | null;
  doctor: DoctorResult | null;
  /** When the health was read, in epoch milliseconds; null before the first read. */
  checkedAt: number | null;
  onCheck(): Promise<void>;
  /** "Add folder": the app takes the person to the allowed folders. */
  onAddFolder(): void;
}) {
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

  const depRow = (item: DepResult): HealthRow => {
    const look = depLook(item);
    const name = t(`hostDeps.names.${item.id}` as Key);
    const lacking = item.state === "missing" || item.state === "outdated";
    const action =
      item.id === "hooks" && lacking
        ? { label: t("hostPage.install"), run: () => setConfirming("hooks") }
        : item.id === "folders" && lacking
          ? { label: t("hostHealth.addFolder"), run: props.onAddFolder }
          : null;
    return {
      key: item.id,
      name,
      look,
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
      step: null,
      action,
    };
  };

  const checkRow = (check: DoctorCheckResult): HealthRow => {
    const look: DepLook =
      check.status === "ok"
        ? { icon: "check", tone: "ok" }
        : check.status === "warn"
          ? { icon: "warning", tone: "warn" }
          : { icon: "cross", tone: "error" };
    const word = { ok: "hostDeps.state.ok", warn: "hostHealth.warning", fail: "hostHealth.failed" }[
      check.status
    ] as Key;
    return {
      key: check.id,
      name: t(`doctor.check.${check.id}` as Key),
      look,
      word: t(word),
      found: [check.detail],
      breaks: null,
      copy: null,
      page: null,
      step:
        check.status === "ok"
          ? null
          : t("doctor.fix", { step: t(`doctor.steps.${check.id}` as Key) }),
      action:
        check.id === "version" && check.status !== "ok" && update
          ? {
              label: t("daemonUpdate.button", { version: update }),
              run: () => setConfirming("update"),
            }
          : null,
    };
  };

  const rows = {
    required: items.filter((item) => item.group === "required").map(depRow),
    optional: items.filter((item) => item.group === "optional").map(depRow),
    checks: checks.map(checkRow),
  };
  const base = depsSummary(items);
  const failing = checks.filter((check) => check.status === "fail").length;
  const warning = checks.filter((check) => check.status === "warn").length;
  const required = (base.kind === "required" ? base.n : 0) + failing;
  const optional = (base.kind === "optional" ? base.n : 0) + warning;
  const read = props.deps !== null || props.doctor !== null;
  const kind = required > 0 ? "required" : optional > 0 ? "optional" : "ok";
  const headline = !read
    ? t("hostDeps.checking")
    : {
        required: t("hostDeps.requiredMissing", { n: required }),
        optional: t("hostDeps.optionalMissing", { n: optional }),
        ok: t("hostDeps.allSet"),
      }[kind];
  const headlineLook: DepLook = !read
    ? { icon: "dash", tone: "off" }
    : kind === "ok"
      ? { icon: "check", tone: "ok" }
      : kind === "optional"
        ? { icon: "warning", tone: "warn" }
        : { icon: "cross", tone: "error" };
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
            className={TONES[row.look.tone]}
          />
          <strong>{row.name}</strong>
          <span className={TONES[row.look.tone]}>{row.word}</span>
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
      <p role="status" className="dep-line">
        <HeadIcon data-slot="dep-icon" aria-hidden="true" className={TONES[headlineLook.tone]} />
        <strong>{headline}</strong>
        {props.checkedAt !== null && (
          <span className="dep-found">
            {t("hostHealth.checked", {
              ago: formatAgo(Math.max(0, store.now() - props.checkedAt), t),
            })}
          </span>
        )}
      </p>
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
            void store
              .hostCommand(host.id, "hooks.install", { confirm: true })
              .then(() => props.onCheck());
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
