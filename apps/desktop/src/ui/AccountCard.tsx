import type { AccountState, QuotaWindow } from "@flightdeck/protocol";
import { Panel } from "@/components/layout/panel";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import { cn } from "@/lib/utils";
import { formatAgo, formatDuration } from "../i18n/format.ts";
import type { Key } from "../i18n/index.ts";

export interface AccountCardProps {
  hostName: string;
  online: boolean;
  /** `undefined` until the host has answered. */
  state: AccountState | undefined;
  /** Milliseconds now: the age of the reading and the time to a reset. */
  now: number;
  formatTime: (iso: string) => string;
  refreshing: boolean;
  copied: boolean;
  onRefresh: () => void;
  onCopy: () => void;
  onTerminal: () => void;
}

/** The windows the card knows how to name, in the order they are drawn. */
const WINDOWS = ["five_hour", "seven_day", "seven_day_opus", "seven_day_sonnet"] as const;

const METER =
  "meter-height w-full [&::-webkit-meter-bar]:h-2 [&::-webkit-meter-bar]:rounded-full [&::-webkit-meter-bar]:border-0 [&::-webkit-meter-bar]:bg-muted";
const METER_COLOR: Record<QuotaWindow["status"], string> = {
  allowed:
    "[&::-webkit-meter-optimum-value]:rounded-full [&::-webkit-meter-optimum-value]:bg-status-running [&::-moz-meter-bar]:bg-status-running",
  allowed_warning:
    "[&::-webkit-meter-optimum-value]:rounded-full [&::-webkit-meter-optimum-value]:bg-status-needs-you [&::-moz-meter-bar]:bg-status-needs-you",
  rejected:
    "[&::-webkit-meter-optimum-value]:rounded-full [&::-webkit-meter-optimum-value]:bg-status-error [&::-moz-meter-bar]:bg-status-error",
};
const PERCENT_COLOR: Partial<Record<QuotaWindow["status"], string>> = {
  allowed_warning: "text-status-needs-you",
  rejected: "text-status-error",
};

const PLANS = ["free", "pro", "max", "ultra", "team", "enterprise"];

/**
 * The Claude account a host's own `claude` is signed in to: who, the plan and its windows. It
 * shows what the host reports and never asks for a login, a code or a token.
 */
export function AccountCard(props: AccountCardProps) {
  const t = useT();
  const { hostName, online, state, now, formatTime } = props;
  const refresh = (label: string, named = true) => (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={props.refreshing}
      {...(named ? { "aria-label": t("account.refreshLabel", { host: hostName }) } : {})}
      onClick={props.onRefresh}
    >
      {label}
    </Button>
  );

  let body: React.ReactNode;
  if (!online) {
    body = (
      <p className="text-muted-foreground text-sm">{t("account.offline", { host: hostName })}</p>
    );
  } else if (
    state === undefined ||
    (state.status === "unknown" && state.readAt === null && !state.error)
  ) {
    body = <p className="text-muted-foreground text-sm">{t("account.loading")}</p>;
  } else if (state.status === "signed_out") {
    body = (
      <>
        <p className="font-medium text-sm">{t("account.signedOut.title")}</p>
        <p className="text-muted-foreground text-sm">{t("account.signedOut.steps")}</p>
        <code className="code-chip rounded bg-muted font-mono text-sm">{state.loginCommand}</code>
        <div className="row-gap2">
          <Button type="button" variant="outline" size="sm" onClick={props.onCopy}>
            {props.copied ? t("account.copied") : t("account.copy")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={props.onTerminal}>
            {t("account.terminal")}
          </Button>
        </div>
      </>
    );
  } else if (state.status === "api_key") {
    body = <p className="text-sm">{t("account.apiKey")}</p>;
  } else if (state.status === "third_party") {
    body = <p className="text-sm">{t("account.provider", { provider: state.provider ?? "" })}</p>;
  } else if (state.status === "unknown") {
    body = state.error ? (
      <>
        <p className="font-medium text-sm">{t("account.unavailable")}</p>
        <p className="text-muted-foreground text-sm">{t(`daemonRefusal.${state.error}` as Key)}</p>
        {refresh(t("account.retry"), false)}
      </>
    ) : (
      <p className="text-sm">{t("account.unknownSignIn")}</p>
    );
  } else {
    const shown = WINDOWS.flatMap((window) => {
      const reading = state.windows.find((w) => w.window === window);
      return reading ? [reading] : [];
    });
    const plan = state.plan;
    body = (
      <>
        <div className="row-wrap">
          {state.name && <span className="font-medium text-sm">{state.name}</span>}
          {plan && (
            <span className="pill rounded-full border text-xs">
              {PLANS.includes(plan) ? t(`account.plans.${plan}` as Key) : plan}
            </span>
          )}
        </div>
        {plan && <span className="text-muted-foreground text-xs">{t("account.planHint")}</span>}
        {state.organization && (
          <span className="text-muted-foreground text-sm">{state.organization}</span>
        )}
        {shown.length === 0 && (
          <p className="text-muted-foreground text-sm">{t("account.noWindows")}</p>
        )}
        {shown.map((reading) => {
          const label = t(`account.windows.${reading.window}` as Key);
          const value = reading.utilization ?? 0;
          const percent = Math.round(value * 100);
          const left = reading.resetsAt ? Date.parse(reading.resetsAt) - now : null;
          const reset =
            left === null ? null : t("account.resetsIn", { d: formatDuration(left, t) });
          return (
            <div
              key={reading.window}
              data-window={reading.window}
              data-status={reading.status}
              className="meter-line"
            >
              <div className="row-baseline-spread">
                <span className="text-sm">{label}</span>
                <span className={cn("font-medium text-sm", PERCENT_COLOR[reading.status])}>
                  {`${percent}%`}
                </span>
              </div>
              <meter
                aria-label={t("account.meter", { window: label, host: hostName })}
                aria-valuetext={
                  reset === null
                    ? t("account.meterTextNoReset", { percent })
                    : t("account.meterText", { percent, reset })
                }
                min={0}
                max={1}
                value={value}
                className={cn(METER, METER_COLOR[reading.status])}
              />
              {reset !== null && reading.resetsAt && (
                <span
                  className="text-muted-foreground text-xs"
                  title={t("quota.resets", { time: formatTime(reading.resetsAt) })}
                >
                  {reset}
                </span>
              )}
            </div>
          );
        })}
        {state.stale && <p className="text-sm text-status-needs-you">{t("account.stale")}</p>}
        <div className="row-wrap-loose text-muted-foreground text-xs">
          {state.readAt && (
            <span>
              {t("account.lastRead", { ago: formatAgo(now - Date.parse(state.readAt), t) })}
            </span>
          )}
          {refresh(props.refreshing ? t("account.refreshing") : t("account.refresh"))}
        </div>
      </>
    );
  }
  return (
    <Panel title={t("account.title")} label={t("account.region", { host: hostName })}>
      {body}
    </Panel>
  );
}
