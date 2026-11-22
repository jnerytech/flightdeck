import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InlineNotice } from "@/shared/feedback/index.ts";
import { Field, Form, FormActions, Inline, Stack } from "@/shared/layout/index.ts";
import type { AppState, AppStore } from "../../lib/app-store.ts";
import { usd } from "../costs/index.ts";
import type { Client } from "./domain/clients.ts";

/** A client's month limit: what it is, what was spent against it, and a form to change it. */
export function ClientBudget(
  props: Readonly<{
    store: AppStore;
    state: Pick<AppState, "clientBudgets">;
    client: Client;
  }>,
) {
  const { store, state, client } = props;
  const { t } = store.i18n;
  const limit = store.clients.budgets()[client.id];
  const seen = state.clientBudgets.find((b) => b.clientId === client.id);
  /** What was typed; null while nothing was, so the field shows the limit that is set. */
  const [typed, setTyped] = useState<string | null>(null);
  const text = typed ?? (limit === undefined ? "" : String(limit));
  const value = Number(text);
  const valid = typed !== null && text.trim() !== "" && value > 0 && Number.isFinite(value);
  /** What the last change did: a polite line, not silence (#3631). */
  const [done, setDone] = useState<string | null>(null);
  const [refocus, setRefocus] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  // The pressed button is disabled or gone once the change is in: the field takes the focus.
  useEffect(() => {
    if (!refocus) return;
    field.current?.focus();
    setRefocus(false);
  }, [refocus]);
  const percent = seen ? Math.round(seen.fraction * 100) : 0;
  const budgetLine =
    seen && seen.spentUsd > 0 && percent === 0 ? "clients.budgetLineSmall" : "clients.budgetLine";

  return (
    <Stack gap={2}>
      {limit !== undefined && (
        <Inline gap={2}>
          <span data-budget-line className="text-sm">
            {seen
              ? t(budgetLine, {
                  spent: usd(seen.spentUsd, t.lang),
                  limit: usd(seen.limitUsd, t.lang),
                  percent,
                })
              : t("clients.budgetLimitOnly", { limit: usd(limit, t.lang) })}
          </span>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("clients.budgetRemove", { name: client.name })}
            onClick={() => {
              store.clients.clearBudget(client.id);
              setTyped(null);
              setDone(t("clients.budgetRemoved"));
              setRefocus(true);
            }}
          >
            {t("clients.budgetRemoveShort")}
          </Button>
        </Inline>
      )}
      {done && <InlineNotice tone="info">{done}</InlineNotice>}
      <Form
        variant="inline"
        aria-label={t("clients.budgetForm", { name: client.name })}
        onSubmit={() => {
          if (!store.clients.setBudget(client.id, value)) return;
          setTyped(null);
          setDone(t("clients.budgetSaved", { limit: usd(value, t.lang) }));
          setRefocus(true);
        }}
      >
        <Field
          label={t("clients.budgetLabel")}
          help={t("clients.budgetHelp")}
          error={
            typed !== null && text.trim() !== "" && !valid ? t("clients.budgetNeeded") : undefined
          }
        >
          {(control) => (
            <Input
              {...control}
              type="number"
              min={0}
              step="any"
              ref={field}
              value={text}
              onChange={(e) => {
                setTyped(e.target.value);
                setDone(null);
              }}
            />
          )}
        </Field>
        <FormActions
          submit={t(limit === undefined ? "clients.budgetSet" : "clients.budgetUpdate")}
          disabled={!valid}
        />
      </Form>
    </Stack>
  );
}
