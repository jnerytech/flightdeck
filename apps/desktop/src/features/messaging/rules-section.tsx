import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";
import { refusalText } from "@/i18n/errors";
import { ActionButton, InlineNotice } from "@/shared/feedback/index.ts";
import { useBusy } from "@/shared/hooks/index.ts";
import {
  Field,
  Form,
  FormActions,
  Inline,
  NativeSelect,
  Panel,
  Stack,
} from "@/shared/layout/index.ts";
import type { T } from "../../i18n/index.ts";
import type { AppStore } from "../../lib/app-store.ts";

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
interface Refusal {
  code: string;
  message: string;
  reason?: string;
  params?: Record<string, string | number>;
}
interface Rules {
  policy: Policy;
  paused: string[];
}

const side = (selector: Selector, t: T): string =>
  KINDS.filter((k) => selector[k])
    .map((k) => {
      const kind = t(`messagingRulesUi.kinds.${k}`);
      return `${kind} ${selector[k]}`;
    })
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
export function MessagingRulesSection(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    hostName: string;
  }>,
) {
  const t = useT();
  const { store, hostId } = props;
  const [rules, setRules] = useState<Rules | null>(null);
  // The refusal that kept the rules from loading; null while they load or once they are shown (issue #3787).
  const [loadRefusal, setLoadRefusal] = useState<Refusal | null>(null);
  // Only the latest read may show its answer: an older one resolving last would show stale rules.
  const latestRead = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [fromKind, setFromKind] = useState<Kind>("host");
  const [fromValue, setFromValue] = useState("");
  const [toKind, setToKind] = useState<Kind>("host");
  const [toValue, setToValue] = useState("");
  const [both, setBoth] = useState(false);
  const [retention, setRetention] = useState("");
  const adding = useBusy();
  const saving = useBusy();

  const show = useCallback((next: Rules) => {
    setRules(next);
    setRetention(String(next.policy.retentionDays ?? ""));
  }, []);
  // A retry keeps the error and its button on screen (busy) until the answer comes, so focus stays put.
  const read = useCallback(async () => {
    const mine = ++latestRead.current;
    const result = await store.hostRequest(hostId, "messaging.rules.get", {});
    if (mine !== latestRead.current) return;
    if (result.ok) {
      setLoadRefusal(null);
      show(result.data);
    } else setLoadRefusal(result);
  }, [store, hostId, show]);
  useEffect(() => {
    void read();
  }, [read]);

  const title = t("messagingRulesUi.title", { host: props.hostName });
  if (!rules) {
    return (
      <section aria-label={title}>
        <Panel title={title}>
          {loadRefusal === null ? (
            <output className="block text-sm">
              {t("messagingRulesUi.loading", { host: props.hostName })}
            </output>
          ) : (
            <>
              <InlineNotice tone="error">
                {t("messagingRulesUi.loadFailed", { host: props.hostName })}{" "}
                {refusalText(loadRefusal.code, loadRefusal.message, t, loadRefusal)}
              </InlineNotice>
              <Inline>
                <ActionButton variant="outline" onClick={read}>
                  {t("messagingRulesUi.retry")}
                </ActionButton>
              </Inline>
            </>
          )}
        </Panel>
      </section>
    );
  }
  const exceptions = rules.policy.exceptions ?? [];
  // The host keeps whole days from 1 up and refuses anything else; the saved value needs no second save.
  const days = Number(retention);
  const retentionChanged =
    retention.trim() !== "" &&
    Number.isInteger(days) &&
    days >= 1 &&
    days !== rules.policy.retentionDays;
  const save = async (patch: Partial<Policy>): Promise<boolean> => {
    const result = await store.hostRequest(hostId, "messaging.rules.set", {
      policy: { ...rules.policy, ...patch },
    });
    if (!result.ok) {
      setError(refusalText(result.code, result.message, t, result));
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
  const kindSelect = (id: string, value: Kind, onChange: (kind: Kind) => void) => (
    <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value as Kind)}>
      {KINDS.map((k) => (
        <option key={k} value={k}>
          {t(`messagingRulesUi.kinds.${k}`)}
        </option>
      ))}
    </NativeSelect>
  );
  const ids = {
    both: `mr-both-${hostId}`,
    fromHint: `rules-from-hint-${hostId}`,
    toHint: `rules-to-hint-${hostId}`,
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
        <Form variant="inline" onSubmit={() => adding.run(add)}>
          <Inline gap={4}>
            <Field label={t("messagingRulesUi.from")}>
              {(control) => (
                <Stack gap={1}>
                  <Inline gap={2}>
                    {kindSelect(control.id, fromKind, setFromKind)}
                    <Input
                      aria-label={t("messagingRulesUi.fromValue")}
                      aria-describedby={ids.fromHint}
                      className="w-40"
                      placeholder={t("messagingRulesUi.fromValue")}
                      value={fromValue}
                      onChange={(e) => setFromValue(e.target.value)}
                    />
                  </Inline>
                  <p id={ids.fromHint} className="text-muted-foreground text-xs">
                    {t(`messagingRulesUi.hints.${fromKind}`)}
                  </p>
                </Stack>
              )}
            </Field>
            <Field label={t("messagingRulesUi.to")}>
              {(control) => (
                <Stack gap={1}>
                  <Inline gap={2}>
                    {kindSelect(control.id, toKind, setToKind)}
                    <Input
                      aria-label={t("messagingRulesUi.toValue")}
                      aria-describedby={ids.toHint}
                      className="w-40"
                      placeholder={t("messagingRulesUi.toValue")}
                      value={toValue}
                      onChange={(e) => setToValue(e.target.value)}
                    />
                  </Inline>
                  <p id={ids.toHint} className="text-muted-foreground text-xs">
                    {t(`messagingRulesUi.hints.${toKind}`)}
                  </p>
                </Stack>
              )}
            </Field>
          </Inline>
          <label htmlFor={ids.both} className="flex items-center gap-2 text-sm">
            <input
              id={ids.both}
              type="checkbox"
              checked={both}
              onChange={(e) => setBoth(e.target.checked)}
            />
            {t("messagingRulesUi.both")}
          </label>
          <FormActions
            submit={t("messagingRulesUi.add")}
            disabled={fromValue.trim() === "" || toValue.trim() === ""}
            disabledReason={t("messagingRulesUi.addNeeds")}
            busy={adding.busy}
          />
        </Form>
        <Form
          variant="inline"
          onSubmit={() => saving.run(() => save({ retentionDays: Number(retention) }))}
        >
          <Field label={t("messagingRulesUi.retention")}>
            {(control) => (
              <Input
                {...control}
                type="number"
                min={1}
                className="w-24"
                value={retention}
                onChange={(e) => setRetention(e.target.value)}
              />
            )}
          </Field>
          <FormActions
            submit={t("messagingRulesUi.saveRetention")}
            disabled={!retentionChanged}
            disabledReason={t("messagingRulesUi.retentionSame")}
            busy={saving.busy}
          />
        </Form>
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
                      void store.messaging.releasePair(hostId, key).then((got) => got && show(got))
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
