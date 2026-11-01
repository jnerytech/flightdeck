import { useState } from "react";
import { Field, Form, FormActions } from "@/components/layout/form";
import { Inline, Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AppState, AppStore } from "../lib/app-store.ts";
import type { Client } from "../lib/clients.ts";
import { usd } from "../lib/costs.ts";

/** A client's month limit: what it is, what was spent against it, and a form to change it. */
export function ClientBudget(props: { store: AppStore; state: AppState; client: Client }) {
  const { store, state, client } = props;
  const { t } = store.i18n;
  const limit = store.clients.budgets()[client.id];
  const seen = state.clientBudgets.find((b) => b.clientId === client.id);
  const [text, setText] = useState("");
  const value = Number(text);
  const valid = text.trim() !== "" && value > 0 && Number.isFinite(value);

  return (
    <Stack gap={2}>
      {limit !== undefined && (
        <Inline gap={2}>
          <span data-budget-line className="text-sm">
            {seen
              ? t("clients.budgetLine", {
                  spent: usd(seen.spentUsd),
                  limit: usd(seen.limitUsd),
                  percent: Math.round(seen.fraction * 100),
                })
              : t("clients.budgetLimitOnly", { limit: usd(limit) })}
          </span>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("clients.budgetRemove", { name: client.name })}
            onClick={() => store.clients.clearBudget(client.id)}
          >
            {t("clients.removeShort")}
          </Button>
        </Inline>
      )}
      <Form
        variant="inline"
        onSubmit={() => {
          if (store.clients.setBudget(client.id, value)) setText("");
        }}
      >
        <Field
          label={t("clients.budgetLabel")}
          help={t("clients.budgetHelp")}
          error={text.trim() !== "" && !valid ? t("clients.budgetNeeded") : undefined}
        >
          {(control) => (
            <Input
              {...control}
              type="number"
              min={0}
              step="any"
              value={text}
              onChange={(e) => setText(e.target.value)}
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
