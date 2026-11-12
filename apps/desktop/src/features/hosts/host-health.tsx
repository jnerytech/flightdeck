import {
  type DepsResult,
  type DoctorResult,
  FEATURE_SERVICE_INSTALL,
  type ServiceInstallResult,
} from "@flightdeck/protocol";
import { Check, ChevronRight, Copy, Minus, TriangleAlert, X } from "lucide-react";
import { useId, useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { Panel } from "@/components/layout/panel";
import { Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import { formatAgo } from "../../i18n/format.ts";
import type { Key } from "../../i18n/index.ts";
import type { AppStore, HostView } from "../../lib/app-store.ts";
import type { DepLook } from "../../lib/deps-summary.ts";
import {
  type Confirming,
  checkRow,
  depRow,
  type HealthRow,
  headlineFor,
  healthCounts,
  needsYou,
  type RowEnv,
  uncoveredChecks,
} from "./host-health-rows.ts";

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
  const [serviceDone, setServiceDone] = useState<ServiceInstallResult | null>(null);
  // #1200: linger needs sudo, so the app only shows the line to copy; it never runs it.
  const lingerLine = serviceDone ? `sudo loginctl enable-linger ${serviceDone.user}` : "";
  const [showFine, setShowFine] = useState(false);
  const fineId = useId();
  const os = host.hostInfo?.os ?? "";
  const offer = host.hostInfo?.update;
  const update = offer?.available ? offer.version : null;
  const items = props.deps?.items ?? [];
  const checks = uncoveredChecks(props.doctor?.checks ?? [], items);

  const env: RowEnv = {
    t,
    os,
    update,
    onAddFolder: props.onAddFolder,
    confirm: setConfirming,
    canInstallService:
      host.status === "online" && (host.hostInfo?.features ?? []).includes(FEATURE_SERVICE_INSTALL),
  };
  const rows = {
    required: items.filter((item) => item.group === "required").map((item) => depRow(item, env)),
    optional: items.filter((item) => item.group === "optional").map((item) => depRow(item, env)),
    checks: checks.map((check) => checkRow(check, env)),
  };
  const { required, optional } = healthCounts(items, checks);
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
  const all = [...rows.required, ...rows.optional, ...rows.checks];
  const fine = all.filter((row) => !needsYou(row));
  const count = (tone: DepLook["tone"]) => all.filter((row) => row.look.tone === tone).length;
  const group = (which: "required" | "optional" | "checks") => {
    const problems = rows[which].filter(needsYou);
    return problems.length === 0 ? null : (
      <Stack gap={2}>
        <h4 className="font-medium text-muted-foreground text-xs">
          {t(`hostHealth.groups.${which}` as Key)}
        </h4>
        <ul aria-label={t(`hostHealth.groups.${which}` as Key)} className="dep-list">
          {problems.map(renderRow)}
        </ul>
      </Stack>
    );
  };
  const compactRow = (row: HealthRow) => {
    const Icon = ICONS[row.look.icon];
    const found = row.found.join(" · ");
    return (
      <li key={row.key} aria-label={row.name} data-slot="dep-compact" className="dep-compact">
        <Icon
          data-slot="dep-icon"
          data-icon={row.look.icon}
          aria-hidden="true"
          className={toneClass(row.look.tone)}
        />
        <span>{row.name}</span>
        <span className={toneClass(row.look.tone)}>{row.word}</span>
        <span className="dep-compact-found" title={found}>
          {found}
        </span>
      </li>
    );
  };

  return (
    <Panel title={t("hostHealth.title")} label={t("hostHealth.title")} slot="host-health">
      <div data-slot="health-summary" className="health-summary">
        <output className="dep-line">
          <HeadIcon
            data-slot="dep-icon"
            aria-hidden="true"
            className={toneClass(headlineLook.tone)}
          />
          <strong>{headline}</strong>
        </output>
        {all.length > 0 && (
          <span className="dep-found">
            {t("hostHealth.counts", {
              ok: count("ok"),
              warn: count("warn"),
              error: count("error"),
            })}
          </span>
        )}
        {/* Outside the live region: the age changes every minute and must not be announced each time. */}
        {props.checkedAt !== null && (
          <span className="dep-found">
            {t("hostHealth.checked", {
              ago: formatAgo(Math.max(0, store.now() - props.checkedAt), t),
            })}
          </span>
        )}
        <ActionButton variant="outline" size="sm" onClick={props.onCheck}>
          {t("hostDeps.check")}
        </ActionButton>
      </div>
      {serviceDone && (
        <output aria-label={t("hostHealth.service.noteLabel")} className="block text-sm">
          <span className="block">
            {t(
              serviceDone.startsAt === "boot"
                ? "hostHealth.service.boot"
                : "hostHealth.service.logon",
            )}
          </span>
          {serviceDone.lingerOff && (
            <>
              <span className="block">{t("hostHealth.service.lingerOff")}</span>
              <span className="dep-fix">
                <code className="font-mono text-xs">{lingerLine}</code>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  aria-label={t("hostHealth.service.copyLinger")}
                  onClick={() => void store.copyText(lingerLine)}
                >
                  <Copy aria-hidden="true" />
                </Button>
              </span>
            </>
          )}
        </output>
      )}
      {group("required")}
      {group("optional")}
      {group("checks")}
      {fine.length > 0 && (
        // A disclosure button, not a <details>: it looks and reads as one (#670).
        <div data-slot="health-ok" className="health-ok">
          <button
            type="button"
            aria-expanded={showFine}
            aria-controls={fineId}
            onClick={() => setShowFine((open) => !open)}
          >
            <ChevronRight data-slot="fold-chevron" aria-hidden="true" />
            {t(showFine ? "hostHealth.okHide" : "hostHealth.okShow", { n: fine.length })}
          </button>
          {showFine && (
            <ul id={fineId} aria-label={t("hostHealth.okList")} className="dep-compact-list">
              {fine.map(compactRow)}
            </ul>
          )}
        </div>
      )}
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
      {confirming === "service" && (
        <ConfirmDialog
          message={
            os === "win32"
              ? t("hostHealth.service.messageWindows", { task: String.raw`Flightdeck\flightdeckd` })
              : t("hostHealth.service.messageLinux")
          }
          confirmLabel={t("hostHealth.service.turnOn")}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null);
            void store.hostCommand(host.id, "service.install", { confirm: true }).then((result) => {
              if (result) setServiceDone(result);
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
            void store.hostUpdate.apply(host.id);
          }}
        />
      )}
    </Panel>
  );
}
