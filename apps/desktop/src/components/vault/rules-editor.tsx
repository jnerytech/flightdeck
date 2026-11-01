import { useId, useRef, useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RulesPreview } from "@/components/vault/rules-preview";
import { useT } from "@/i18n/context";
import { refusalText } from "@/i18n/errors";
import type { AppStore } from "@/lib/app-store";
import type { SecretMeta } from "@/lib/vault";
import {
  DAYS,
  DECISIONS,
  draftOf,
  move,
  newDraft,
  PURPOSES,
  REQUESTERS,
  type RuleDraft,
  ruleOf,
} from "@/lib/vault-rules-form";

const SELECT =
  "h-9 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Phase 19: a secret's usage rules, in order (the first that matches decides). The connected
 * hosts check them when they are saved, and what they refuse (the ceiling) shows here.
 */
export function RulesEditor(props: {
  store: AppStore;
  secret: SecretMeta;
  /** A new rule matching this goes first, where it decides before the others. */
  seed?: Record<string, string>;
  onClose(): void;
}) {
  const t = useT();
  const id = useId();
  const { store, secret } = props;
  const [drafts, setDrafts] = useState<RuleDraft[]>(() => {
    const saved = store.vaultRules(secret.id).map(draftOf);
    return props.seed ? [{ ...newDraft(saved), ...props.seed }, ...saved] : saved;
  });
  const [error, setError] = useState<string | null>(null);
  // A ref: the drop reads it in the same gesture that set it, before any render.
  const dragged = useRef<number | null>(null);
  const edit = (i: number, patch: Partial<RuleDraft>) =>
    setDrafts(drafts.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  const save = async () => {
    const result = await store.setVaultRules(secret.id, drafts.map(ruleOf));
    if (result.ok) props.onClose();
    else setError(refusalText(result.code, result.message, t));
  };

  const text = (i: number, key: keyof RuleDraft, label: string, type = "text") => (
    <div className="flex flex-col gap-1">
      <label htmlFor={`${id}-${i}-${key}`}>{label}</label>
      <Input
        id={`${id}-${i}-${key}`}
        type={type}
        value={drafts[i]?.[key] as string}
        onChange={(e) => edit(i, { [key]: e.target.value })}
      />
    </div>
  );
  const choice = (
    i: number,
    key: keyof RuleDraft,
    label: string,
    options: Array<[string, string]>,
  ) => (
    <div className="flex flex-col gap-1">
      <label htmlFor={`${id}-${i}-${key}`}>{label}</label>
      <select
        id={`${id}-${i}-${key}`}
        className={SELECT}
        value={drafts[i]?.[key] as string}
        onChange={(e) => edit(i, { [key]: e.target.value })}
      >
        {options.map(([value, name]) => (
          <option key={value} value={value}>
            {name}
          </option>
        ))}
      </select>
    </div>
  );
  const decisions = DECISIONS.map((d): [string, string] => [d, t(`vaultRulesUi.decision.${d}`)]);

  return (
    <section
      aria-label={t("vaultRulesUi.title", { name: secret.name })}
      className="mb-4 flex flex-col gap-3 rounded-lg border p-4 text-sm"
    >
      <h2 className="font-medium">{t("vaultRulesUi.title", { name: secret.name })}</h2>
      <p className="text-muted-foreground text-xs">{t("vaultRulesUi.hint")}</p>
      {drafts.length === 0 && <p className="text-muted-foreground">{t("vaultRulesUi.empty")}</p>}
      {drafts.map((draft, i) => {
        const n = i + 1;
        const at = (label: string) => t("vaultRulesUi.at", { label, n });
        return (
          <fieldset
            key={draft.id}
            draggable
            onDragStart={() => {
              dragged.current = i;
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragged.current !== null) setDrafts(move(drafts, dragged.current, i));
              dragged.current = null;
            }}
            className="flex flex-col gap-2 rounded-md border p-3"
          >
            <legend className="px-1 font-medium">{t("vaultRulesUi.rule", { n })}</legend>
            <div className="grid gap-2 @2xl:grid-cols-3">
              {choice(i, "requester", at(t("vaultRulesUi.requester")), [
                ["", t("vaultRulesUi.any")],
                ...REQUESTERS.map((r): [string, string] => [r, t(`actionsUi.requester.${r}`)]),
              ])}
              {choice(i, "purpose", at(t("vaultRulesUi.purpose")), [
                ["", t("vaultRulesUi.any")],
                ...PURPOSES.map((p): [string, string] => [p, t(`vaultRulesUi.purposes.${p}`)]),
              ])}
              {text(i, "action", at(t("vaultRulesUi.action")))}
              {text(i, "host", at(t("vaultRulesUi.host")))}
              {text(i, "tags", at(t("vaultRulesUi.tags")))}
              {text(i, "project", at(t("vaultRulesUi.project")))}
              {text(i, "session", at(t("vaultRulesUi.session")))}
              {choice(i, "decision", at(t("vaultRulesUi.decisionLabel")), decisions)}
            </div>
            {draft.decision === "ask" && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.once}
                  onChange={(e) => edit(i, { once: e.target.checked })}
                />
                {at(t("vaultRulesUi.once"))}
              </label>
            )}
            <fieldset className="flex flex-wrap items-center gap-2">
              <legend className="text-muted-foreground text-xs">{t("vaultRulesUi.window")}</legend>
              {DAYS.map((day) => (
                <label key={day} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={draft.days.includes(day)}
                    onChange={(e) =>
                      edit(i, {
                        days: e.target.checked
                          ? DAYS.filter((d) => d === day || draft.days.includes(d))
                          : draft.days.filter((d) => d !== day),
                      })
                    }
                  />
                  {at(t(`vaultRulesUi.days.${day}`))}
                </label>
              ))}
            </fieldset>
            <div className="grid gap-2 @2xl:grid-cols-3">
              {text(i, "from", at(t("vaultRulesUi.from")), "time")}
              {text(i, "to", at(t("vaultRulesUi.to")), "time")}
              {choice(i, "outsideWindow", at(t("vaultRulesUi.outside")), decisions)}
              {text(i, "maxPerHour", at(t("vaultRulesUi.maxPerHour")), "number")}
              {text(i, "maxPerDay", at(t("vaultRulesUi.maxPerDay")), "number")}
              {text(i, "expiresAt", at(t("vaultRulesUi.expiresAt")), "datetime-local")}
            </div>
            <div className="flex gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={i === 0}
                onClick={() => setDrafts(move(drafts, i, i - 1))}
              >
                {t("vaultRulesUi.up", { n })}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={i === drafts.length - 1}
                onClick={() => setDrafts(move(drafts, i, i + 1))}
              >
                {t("vaultRulesUi.down", { n })}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setDrafts(drafts.filter((_, j) => j !== i))}
              >
                {t("vaultRulesUi.remove", { n })}
              </Button>
            </div>
          </fieldset>
        );
      })}
      <RulesPreview store={store} secretId={secret.id} />
      {error && (
        <p role="alert" className="text-status-error">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => setDrafts([...drafts, newDraft(drafts)])}
        >
          {t("vaultRulesUi.add")}
        </Button>
        <ActionButton type="button" onClick={() => save()}>
          {t("vaultRulesUi.save")}
        </ActionButton>
        <Button type="button" variant="ghost" onClick={props.onClose}>
          {t("vaultRulesUi.cancel")}
        </Button>
      </div>
    </section>
  );
}
