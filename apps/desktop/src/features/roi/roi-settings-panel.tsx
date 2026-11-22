import { useEffect, useId, useReducer, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";
import type { Key } from "@/i18n/index";
import type { AppStore } from "@/lib/app-store";
import { useStoreSlice } from "@/lib/use-store";
import { ConfirmDialog } from "@/shared/feedback/index.ts";
import { CheckField, Field, FieldRow, Form, Panel, SwitchField } from "@/shared/layout/index.ts";
import { RoiSettingsError } from "./domain/roi-settings.ts";

/** Empty means "none"; anything else must be a number. */
function amountOf(text: string): number | null | "bad" {
  if (text.trim() === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : "bad";
}

/** A limit text that cannot be a limit: not a number, or not above zero. */
function badLimit(text: string): boolean {
  const n = amountOf(text);
  return n === "bad" || (n !== null && n <= 0);
}

/** The fields an error can sit under. */
type FieldName = "rate" | "cap" | "name" | "tokens" | "cost";

/** The field a refusal is about, or none: the error then shows at the top of the panel. */
type Where = (reason: string) => FieldName | null;

/**
 * Phase 36: what the person types for the return on cost: the default hourly rate, whether their
 * review time counts, and the people (groups of hosts with a monthly limit). Money stays in the app.
 * Each save is a form (#4193): Enter saves it, an error shows under its field with focus on it, and
 * every change is announced.
 */
export function RoiSettingsPanel(props: Readonly<{ store: AppStore }>) {
  const { store } = props;
  const t = useT();
  const hosts = useStoreSlice(store, ["hosts", "roiRevision"]).hosts;
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  /** A refusal the field cannot take (no field of its own) shows here, at the top. */
  const [message, setMessage] = useState<string | null>(null);
  /** A refusal under its field; a new object each time, so focus moves even to the same field again. */
  const [refusal, setRefusal] = useState<{ field: FieldName; text: string } | null>(null);
  /** What the last change said: "Saved.", "Person added.". Gone when the person edits again. */
  const [said, setSaid] = useState<string | null>(null);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const settings = store.roi.data();
  const [rate, setRate] = useState(
    settings.defaultRate === null ? "" : String(settings.defaultRate),
  );
  const [cap, setCap] = useState(String(settings.reviewCapMinutes));
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [tokenLimit, setTokenLimit] = useState("");
  const [costLimit, setCostLimit] = useState("");
  /** The text fields by name, so a refusal can take focus to the one it is about. */
  const inputs = useRef<Record<FieldName, HTMLInputElement | null>>({
    rate: null,
    cap: null,
    name: null,
    tokens: null,
    cost: null,
  });
  const hostsId = useId();

  // A refusal under a field takes focus to it, so the person fixes it where it is told.
  useEffect(() => {
    if (refusal) inputs.current[refusal.field]?.focus();
  }, [refusal]);

  /** Runs a change of the settings; a refusal is told by its reason, a good change says `announce`. */
  const run = (change: () => void, announce: string | null = null, where: Where = () => null) => {
    try {
      change();
      setMessage(null);
      setRefusal(null);
      setSaid(announce);
      rerender();
    } catch (error) {
      setSaid(null);
      const reason = error instanceof RoiSettingsError ? error.reason : "number";
      const text = t(`roiUi.settingsPanel.error.${reason}` as Key);
      const field = where(reason);
      setMessage(field ? null : text);
      setRefusal(field ? { field, text } : null);
    }
  };
  const underRate: Where = () => "rate";
  const underCap: Where = () => "cap";
  const underPerson: Where = (reason) => {
    if (reason === "person_name_empty" || reason === "person_name_taken") return "name";
    if (reason === "person_limit_invalid")
      return !badLimit(tokenLimit) && badLimit(costLimit) ? "cost" : "tokens";
    return null;
  };
  const withNumber = (text: string, apply: (n: number | null) => void) => {
    const n = amountOf(text);
    if (n === "bad")
      return run(
        () => {
          throw new RoiSettingsError("number");
        },
        null,
        underRate,
      );
    run(() => apply(n), t("roiUi.settingsPanel.saved"), underRate);
  };
  const errorOf = (field: FieldName) => (refusal?.field === field ? refusal.text : undefined);
  const edited = (set: (value: string) => void) => (e: { target: { value: string } }) => {
    set(e.target.value);
    setSaid(null);
  };

  return (
    <Panel
      title={t("roiUi.settingsPanel.title")}
      label={t("roiUi.settingsPanel.title")}
      slot="roi-settings"
    >
      {message && (
        <p role="alert" className="text-destructive text-sm">
          {message}
        </p>
      )}
      <output className="text-muted-foreground text-sm empty:sr-only">{said ?? ""}</output>
      <Form
        variant="inline"
        aria-label={t("roiUi.settingsPanel.saveRate")}
        onSubmit={() => withNumber(rate, (n) => store.roi.setDefaultRate(n))}
      >
        <FieldRow align="end">
          <Field label={t("roiUi.settingsPanel.defaultRate")} error={errorOf("rate")}>
            {(control) => (
              <Input
                {...control}
                ref={(el) => {
                  inputs.current.rate = el;
                }}
                inputMode="decimal"
                className="h-8 w-28"
                value={rate}
                onChange={edited(setRate)}
              />
            )}
          </Field>
          <Button type="submit" size="sm" variant="outline">
            {t("roiUi.settingsPanel.saveRate")}
          </Button>
        </FieldRow>
      </Form>
      <SwitchField
        checked={settings.countReview}
        onChange={(on) =>
          run(
            () => store.roi.setCountReview(on),
            t(on ? "roiUi.settingsPanel.reviewOn" : "roiUi.settingsPanel.reviewOff"),
          )
        }
      >
        {t("roiUi.settingsPanel.countReview")}
      </SwitchField>
      <Form
        variant="inline"
        aria-label={t("roiUi.settingsPanel.saveCap")}
        onSubmit={() =>
          run(() => store.roi.setReviewCap(Number(cap)), t("roiUi.settingsPanel.saved"), underCap)
        }
      >
        <FieldRow align="end">
          <Field label={t("roiUi.settingsPanel.reviewCap")} error={errorOf("cap")}>
            {(control) => (
              <Input
                {...control}
                ref={(el) => {
                  inputs.current.cap = el;
                }}
                inputMode="numeric"
                className="h-8 w-20"
                value={cap}
                onChange={edited(setCap)}
              />
            )}
          </Field>
          <Button type="submit" size="sm" variant="outline">
            {t("roiUi.settingsPanel.saveCap")}
          </Button>
        </FieldRow>
      </Form>
      <h4 className="font-medium text-sm">{t("roiUi.settingsPanel.peopleTitle")}</h4>
      {settings.people.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {settings.people.map((p) => (
            <li key={p.id} className="flex items-center gap-2">
              <span>{p.name}</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setRemoving({ id: p.id, name: p.name })}
              >
                {t("roiUi.settingsPanel.removePerson", { name: p.name })}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Form
        variant="inline"
        aria-label={t("roiUi.settingsPanel.addPerson")}
        onSubmit={() => {
          const tokens = amountOf(tokenLimit);
          const cost = amountOf(costLimit);
          run(
            () => {
              if (tokens === "bad" || cost === "bad")
                throw new RoiSettingsError("person_limit_invalid");
              store.roi.addPerson({ name, hostIds: picked, tokenLimit: tokens, costLimit: cost });
              setName("");
              setPicked([]);
              setTokenLimit("");
              setCostLimit("");
            },
            t("roiUi.settingsPanel.personAdded"),
            underPerson,
          );
        }}
      >
        <Field label={t("roiUi.settingsPanel.personName")} error={errorOf("name")}>
          {(control) => (
            <Input
              {...control}
              ref={(el) => {
                inputs.current.name = el;
              }}
              className="h-8 w-40"
              value={name}
              onChange={edited(setName)}
            />
          )}
        </Field>
        <fieldset
          aria-labelledby={hostsId}
          className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0 text-sm"
        >
          <span id={hostsId}>{t("roiUi.settingsPanel.personHosts")}</span>
          <div className="team-row">
            {hosts.map((h) => (
              <HostChoice
                key={h.id}
                name={h.name}
                owner={store.roi.personOf(h.id)?.name ?? null}
                checked={picked.includes(h.id)}
                onChange={(on) =>
                  setPicked(on ? [...picked, h.id] : picked.filter((id) => id !== h.id))
                }
              />
            ))}
          </div>
        </fieldset>
        <FieldRow align="end">
          <Field label={t("roiUi.settingsPanel.tokenLimit")} error={errorOf("tokens")}>
            {(control) => (
              <Input
                {...control}
                ref={(el) => {
                  inputs.current.tokens = el;
                }}
                inputMode="numeric"
                className="h-8 w-32"
                value={tokenLimit}
                onChange={edited(setTokenLimit)}
              />
            )}
          </Field>
          <Field label={t("roiUi.settingsPanel.costLimit")} error={errorOf("cost")}>
            {(control) => (
              <Input
                {...control}
                ref={(el) => {
                  inputs.current.cost = el;
                }}
                inputMode="decimal"
                className="h-8 w-28"
                value={costLimit}
                onChange={edited(setCostLimit)}
              />
            )}
          </Field>
        </FieldRow>
        <Button type="submit" size="sm" variant="outline" className="self-start">
          {t("roiUi.settingsPanel.addPerson")}
        </Button>
      </Form>
      {removing && (
        <ConfirmDialog
          message={t("roiUi.settingsPanel.removeAsk", { name: removing.name })}
          confirmLabel={t("roiUi.settingsPanel.removeConfirm")}
          destructive
          onConfirm={() => {
            const { id } = removing;
            setRemoving(null);
            run(() => store.roi.removePerson(id), t("roiUi.settingsPanel.personRemoved"));
          }}
          onCancel={() => setRemoving(null)}
        />
      )}
    </Panel>
  );
}

/** One host to pick for a person; a host another person has is off, and says who has it. */
function HostChoice(
  props: Readonly<{
    name: string;
    owner: string | null;
    checked: boolean;
    onChange(on: boolean): void;
  }>,
) {
  const t = useT();
  const noteId = useId();
  return (
    <span className="inline-flex flex-col">
      <CheckField
        checked={props.checked}
        disabled={props.owner !== null}
        describedBy={props.owner === null ? undefined : noteId}
        onChange={props.onChange}
      >
        {props.name}
      </CheckField>
      {props.owner !== null && (
        <span id={noteId} className="text-muted-foreground text-xs">
          {t("roiUi.settingsPanel.hostTaken", { name: props.owner })}
        </span>
      )}
    </span>
  );
}
