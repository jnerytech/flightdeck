import type { AccountState, QuotaWindow } from "@flightdeck/protocol";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import { cn } from "@/lib/utils";
import { Inline, Panel, Stack } from "@/shared/layout/index.ts";
import { formatAgo, formatDuration } from "../../i18n/format.ts";
import type { Key } from "../../i18n/index.ts";

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

const PLANS = new Set(["free", "pro", "max", "ultra", "team", "enterprise"]);

type Reading = Extract<
  NonNullable<AccountCardProps["state"]>,
  { windows: unknown }
>["windows"][number];

/** One window of the plan: its name, the percent used and, when known, when it resets. */
function WindowMeter(
  props: Readonly<{
    reading: Reading;
    hostName: string;
    now: number;
    formatTime: AccountCardProps["formatTime"];
  }>,
) {
  const t = useT();
  const { reading, hostName, now, formatTime } = props;
  const label = t(`account.windows.${reading.window}` as Key);
  const known = reading.utilization !== null;
  const percent = Math.round((reading.utilization ?? 0) * 100);
  const left = reading.resetsAt ? Date.parse(reading.resetsAt) - now : null;
  const reset = left === null ? null : t("account.resetsIn", { d: formatDuration(left, t) });
  const said =
    reset === null
      ? t("account.meterTextNoReset", { percent })
      : t("account.meterText", { percent, reset });
  const warned = reading.status === "allowed" ? null : reading.status;
  return (
    <div data-window={reading.window} data-status={reading.status} className="meter-line">
      <div className="row-baseline-spread">
        <span className="text-sm">{label}</span>
        <Inline gap={2} className="text-sm">
          <span className={cn("font-medium", PERCENT_COLOR[reading.status])}>
            {known ? `${percent}%` : t("account.unknownUsage")}
          </span>
          {warned && (
            <span className={cn("text-xs", PERCENT_COLOR[warned])}>
              {t(`account.statusLine.${warned}` as Key)}
            </span>
          )}
        </Inline>
      </div>
      {known && (
        <meter
          aria-label={t("account.meter", { window: label, host: hostName })}
          aria-valuetext={
            warned
              ? t("account.meterWithStatus", {
                  text: said,
                  status: t(`account.statusText.${warned}` as Key),
                })
              : said
          }
          min={0}
          max={1}
          value={reading.utilization ?? 0}
          className={cn(METER, METER_COLOR[reading.status])}
        />
      )}
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
}

type Refresh = (label: string, named?: boolean) => React.ReactNode;

/** Signed out: the command to run on the host, with the buttons that copy it or open a terminal. */
function SignedOutBody(
  props: Readonly<{
    state: AccountState;
    copied: boolean;
    onCopy: () => void;
    onTerminal: () => void;
  }>,
) {
  const t = useT();
  const { state, copied, onCopy, onTerminal } = props;
  return (
    <>
      <p className="font-medium text-sm">{t("account.signedOut.title")}</p>
      <p className="text-muted-foreground text-sm">{t("account.signedOut.steps")}</p>
      <code className="code-chip rounded bg-muted font-mono text-sm">{state.loginCommand}</code>
      <output className="sr-only">{copied ? t("account.copied") : ""}</output>
      <div className="row-gap2">
        <Button type="button" variant="outline" size="sm" onClick={onCopy}>
          {copied ? t("account.copied") : t("account.copy")}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onTerminal}>
          {t("account.terminal")}
        </Button>
      </div>
    </>
  );
}

/** The host could not say who is signed in: why, with a retry, or that it is not known. */
function UnknownBody(props: Readonly<{ state: AccountState; refresh: Refresh }>) {
  const t = useT();
  const { state, refresh } = props;
  if (!state.error) return <p className="text-sm">{t("account.unknownSignIn")}</p>;
  return (
    <>
      <div role="alert">
        <Stack gap={2}>
          <p className="font-medium text-sm">{t("account.unavailable")}</p>
          <p className="text-muted-foreground text-sm">
            {t(`daemonRefusal.${state.error}` as Key)}
          </p>
        </Stack>
      </div>
      {refresh(t("account.retry"), false)}
    </>
  );
}

/** Signed in: the name, the plan and the organization, then the windows and when they were read. */
function SignedInBody(
  props: Readonly<{
    state: AccountState;
    hostName: string;
    now: number;
    formatTime: (iso: string) => string;
    refreshing: boolean;
    refresh: Refresh;
  }>,
) {
  const t = useT();
  const { state, hostName, now, formatTime, refreshing, refresh } = props;
  const shown = WINDOWS.flatMap((window) => {
    const reading = state.windows.find((w) => w.window === window);
    return reading ? [reading] : [];
  });
  const plan = state.plan;
  return (
    <>
      <div className="row-wrap">
        {state.name && <span className="font-medium text-sm">{state.name}</span>}
        {plan && (
          <span className="pill rounded-full border text-xs">
            {PLANS.has(plan) ? t(`account.plans.${plan}` as Key) : plan}
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
      {shown.map((reading) => (
        <WindowMeter
          key={reading.window}
          reading={reading}
          hostName={hostName}
          now={now}
          formatTime={formatTime}
        />
      ))}
      {state.stale && <p className="text-sm text-status-needs-you">{t("account.stale")}</p>}
      <div className="row-wrap-loose text-muted-foreground text-xs">
        <output>
          {refreshing
            ? t("account.refreshing")
            : state.readAt &&
              t("account.lastRead", { ago: formatAgo(now - Date.parse(state.readAt), t) })}
        </output>
        {refresh(t("account.refresh"))}
      </div>
    </>
  );
}

/** Nothing was read from the host yet, and nothing went wrong either. */
const notReadYet = (state: NonNullable<AccountCardProps["state"]>) =>
  state.status === "unknown" && state.readAt === null && !state.error;

/**
 * The Claude account a host's own `claude` is signed in to: who, the plan and its windows. It
 * shows what the host reports and never asks for a login, a code or a token.
 */
export function AccountCard(props: Readonly<AccountCardProps>) {
  const t = useT();
  const { hostName, online, state, now, formatTime } = props;
  const refresh = (label: string, named = true) => (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-disabled={props.refreshing || undefined}
      className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
      {...(named ? { "aria-label": t("account.refreshLabel", { host: hostName }) } : {})}
      onClick={() => {
        if (!props.refreshing) props.onRefresh();
      }}
    >
      {label}
    </Button>
  );

  let body: React.ReactNode;
  if (!online) {
    body = (
      <p className="text-muted-foreground text-sm">{t("account.offline", { host: hostName })}</p>
    );
  } else if (state === undefined || notReadYet(state)) {
    body = <output className="text-muted-foreground text-sm">{t("account.loading")}</output>;
  } else if (state.status === "signed_out") {
    body = (
      <SignedOutBody
        state={state}
        copied={props.copied}
        onCopy={props.onCopy}
        onTerminal={props.onTerminal}
      />
    );
  } else if (state.status === "api_key") {
    body = <p className="text-sm">{t("account.apiKey")}</p>;
  } else if (state.status === "third_party") {
    body = <p className="text-sm">{t("account.provider", { provider: state.provider ?? "" })}</p>;
  } else if (state.status === "unknown") {
    body = <UnknownBody state={state} refresh={refresh} />;
  } else {
    body = (
      <SignedInBody
        state={state}
        hostName={hostName}
        now={now}
        formatTime={formatTime}
        refreshing={props.refreshing}
        refresh={refresh}
      />
    );
  }
  return (
    <Panel title={t("account.title")} label={t("account.region", { host: hostName })}>
      {body}
    </Panel>
  );
}
