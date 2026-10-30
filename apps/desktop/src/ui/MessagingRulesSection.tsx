import { useCallback, useEffect, useState } from "react";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { Panel } from "@/components/layout/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";
import type { T } from "../i18n/index.ts";
import type { AppStore } from "../lib/app-store.ts";

/** The fields of a selector, as the daemon's policy takes them. */
const KINDS = ["session", "project", "team", "host"] as const;
type Kind = (typeof KINDS)[number];
type Selector = Partial<Record<Kind, string>>;
interface Exception {
  id: string;
  from: Selector;
  to: Selector;
  bothWays?: boolean;
}
type Policy = Record<string, unknown> & { exceptions?: Exception[]; retentionDays?: number };
interface Rules {
  policy: Policy;
  paused: string[];
}

const side = (selector: Selector, t: T): string =>
  KINDS.filter((k) => selector[k])
    .map((k) => `${t(`messagingRulesUi.kinds.${k}`)} ${selector[k]}`)
    .join(", ");

const label = (e: Exception, t: T): string =>
  t(e.bothWays ? "messagingRulesUi.bothWays" : "messagingRulesUi.oneWay", {
    from: side(e.from, t),
    to: side(e.to, t),
  });

/**
 * Phase 21: a host's messaging policy (exceptions both ways, retention) and the pairs it paused
 * for a loop. Each save sends the whole policy the host gave, with one field changed: the daemon
 * puts the default back in any field left out.
 */
export function MessagingRulesSection(props: {
  store: AppStore;
  hostId: string;
  hostName: string;
}) {
  const t = useT();
  const { store, hostId } = props;
  const [rules, setRules] = useState<Rules | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fromKind, setFromKind] = useState<Kind>("host");
  const [fromValue, setFromValue] = useState("");
  const [toKind, setToKind] = useState<Kind>("host");
  const [toValue, setToValue] = useState("");
  const [both, setBoth] = useState(false);
  const [retention, setRetention] = useState("");

  const show = useCallback((next: Rules) => {
    setRules(next);
    setRetention(String(next.policy.retentionDays ?? ""));
  }, []);
  useEffect(() => {
    void store.hostCommand(hostId, "messaging.rules.get", {}).then((got) => got && show(got));
  }, [store, hostId, show]);

  if (!rules) return null;
  const exceptions = rules.policy.exceptions ?? [];
  const save = async (patch: Partial<Policy>): Promise<boolean> => {
    const result = await store.hostRequest(hostId, "messaging.rules.set", {
      policy: { ...rules.policy, ...patch },
    });
    if (!result.ok) {
      setError(result.message);
      return false;
    }
    setError(null);
    show(result.data);
    return true;
  };
  const add = async () => {
    const exception: Exception = {
      id: crypto.randomUUID(),
      from: { [fromKind]: fromValue.trim() },
      to: { [toKind]: toValue.trim() },
      ...(both ? { bothWays: true } : {}),
    };
    if (await save({ exceptions: [...exceptions, exception] })) {
      setFromValue("");
      setToValue("");
      setBoth(false);
    }
  };
  const select =
    "h-9 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const title = t("messagingRulesUi.title", { host: props.hostName });
  const kindSelect = (id: string, value: Kind, onChange: (kind: Kind) => void) => (
    <select
      id={id}
      className={select}
      value={value}
      onChange={(e) => onChange(e.target.value as Kind)}
    >
      {KINDS.map((k) => (
        <option key={k} value={k}>
          {t(`messagingRulesUi.kinds.${k}`)}
        </option>
      ))}
    </select>
  );
  const ids = {
    from: `mr-from-${hostId}`,
    fromValue: `mr-from-value-${hostId}`,
    to: `mr-to-${hostId}`,
    toValue: `mr-to-value-${hostId}`,
    both: `mr-both-${hostId}`,
    retention: `mr-retention-${hostId}`,
  };
  return (
    <section aria-label={title}>
      <Panel title={title}>
        <p className="text-muted-foreground text-sm">{t("messagingRulesUi.intro")}</p>
        {error && <InlineNotice tone="error">{error}</InlineNotice>}
        <h3 className="font-medium text-sm">{t("messagingRulesUi.exceptions")}</h3>
        {exceptions.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("messagingRulesUi.none")}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {exceptions.map((e) => (
              <li key={e.id} className="flex items-center gap-2">
                <span className="flex-1">{label(e, t)}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t("messagingRulesUi.remove", { label: label(e, t) })}
                  onClick={() => void save({ exceptions: exceptions.filter((x) => x.id !== e.id) })}
                >
                  {t("messagingRulesUi.removeShort")}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <label htmlFor={ids.from} className="flex flex-col gap-1 text-xs">
            {t("messagingRulesUi.from")}
          </label>
          {kindSelect(ids.from, fromKind, setFromKind)}
          <label htmlFor={ids.fromValue} className="sr-only">
            {t("messagingRulesUi.fromValue")}
          </label>
          <Input
            id={ids.fromValue}
            className="w-40"
            placeholder={t("messagingRulesUi.fromValue")}
            value={fromValue}
            onChange={(e) => setFromValue(e.target.value)}
          />
          <label htmlFor={ids.to} className="flex flex-col gap-1 text-xs">
            {t("messagingRulesUi.to")}
          </label>
          {kindSelect(ids.to, toKind, setToKind)}
          <label htmlFor={ids.toValue} className="sr-only">
            {t("messagingRulesUi.toValue")}
          </label>
          <Input
            id={ids.toValue}
            className="w-40"
            placeholder={t("messagingRulesUi.toValue")}
            value={toValue}
            onChange={(e) => setToValue(e.target.value)}
          />
          <label htmlFor={ids.both} className="flex items-center gap-2 text-sm">
            <input
              id={ids.both}
              type="checkbox"
              checked={both}
              onChange={(e) => setBoth(e.target.checked)}
            />
            {t("messagingRulesUi.both")}
          </label>
          <Button
            variant="outline"
            disabled={fromValue.trim() === "" || toValue.trim() === ""}
            onClick={() => void add()}
          >
            {t("messagingRulesUi.add")}
          </Button>
        </div>
        <div className="flex items-end gap-2">
          <label htmlFor={ids.retention} className="flex flex-col gap-1 text-xs">
            {t("messagingRulesUi.retention")}
          </label>
          <Input
            id={ids.retention}
            type="number"
            min={1}
            className="w-24"
            value={retention}
            onChange={(e) => setRetention(e.target.value)}
          />
          <Button variant="outline" onClick={() => void save({ retentionDays: Number(retention) })}>
            {t("messagingRulesUi.saveRetention")}
          </Button>
        </div>
        <h3 className="font-medium text-sm">{t("messagingRulesUi.paused")}</h3>
        {rules.paused.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("messagingRulesUi.noPaused")}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {rules.paused.map((key) => {
              const [a = "", b = ""] = key.split("|");
              const pair = t("messagingRulesUi.pair", { a, b });
              return (
                <li key={key} className="flex items-center gap-2">
                  <span className="flex-1">{pair}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t("messagingRulesUi.release", { pair })}
                    onClick={() =>
                      void store.releasePair(hostId, key).then((got) => got && show(got))
                    }
                  >
                    {t("messagingRulesUi.releaseShort")}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </section>
  );
}
