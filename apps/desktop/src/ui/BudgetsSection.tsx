import type { Budget, BudgetInput } from "@flightdeck/protocol";
import { useState } from "react";
import { Panel } from "@/components/layout/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AppStore } from "../lib/app-store.ts";
import { budgetLabel, budgetLine } from "../lib/budgets.ts";

interface Draft {
  id?: string;
  scope: Budget["scope"];
  projectKey: string;
  period: Budget["period"];
  limitUsd: string;
  action: Budget["action"];
}

const EMPTY: Draft = {
  scope: "host",
  projectKey: "",
  period: "day",
  limitUsd: "",
  action: "notify",
};

/** A host's budgets with what each one spent in its period, and a form to create or edit one. */
export function BudgetsSection(props: {
  store: AppStore;
  hostId: string;
  hostName: string;
  budgets: Budget[];
}) {
  const { store, hostId } = props;
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const save = async () => {
    const input: BudgetInput = {
      ...(draft.id ? { id: draft.id } : {}),
      scope: draft.scope,
      ...(draft.scope === "project" ? { projectKey: draft.projectKey } : {}),
      period: draft.period,
      limitUsd: Number(draft.limitUsd),
      action: draft.action,
    };
    await store.setBudget(hostId, input);
    setDraft(EMPTY);
  };
  const select =
    "h-9 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <section aria-label={`Orçamentos de ${props.hostName}`}>
      <Panel title={`Orçamentos de ${props.hostName}`}>
        <ul className="flex flex-col gap-1 text-sm">
          {props.budgets.map((budget) => (
            <li key={budget.id} className="flex items-center gap-2">
              <span className="flex-1">{budgetLine(budget)}</span>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Editar ${budgetLabel(budget)}`}
                onClick={() =>
                  setDraft({
                    id: budget.id,
                    scope: budget.scope,
                    projectKey: budget.projectKey ?? "",
                    period: budget.period,
                    limitUsd: String(budget.limitUsd),
                    action: budget.action,
                  })
                }
              >
                Editar
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remover ${budgetLabel(budget)}`}
                onClick={() => void store.removeBudget(hostId, budget)}
              >
                Remover
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Escopo"
            className={select}
            value={draft.scope}
            onChange={(e) => set({ scope: e.target.value as Draft["scope"] })}
          >
            <option value="host">host</option>
            <option value="project">projeto</option>
          </select>
          {draft.scope === "project" && (
            <Input
              aria-label="Projeto do orçamento"
              className="w-40"
              value={draft.projectKey}
              onChange={(e) => set({ projectKey: e.target.value })}
            />
          )}
          <select
            aria-label="Período"
            className={select}
            value={draft.period}
            onChange={(e) => set({ period: e.target.value as Draft["period"] })}
          >
            <option value="day">dia</option>
            <option value="month">mês</option>
          </select>
          <Input
            type="number"
            aria-label="Limite (US$)"
            className="w-28"
            value={draft.limitUsd}
            onChange={(e) => set({ limitUsd: e.target.value })}
          />
          <select
            aria-label="Ação"
            className={select}
            value={draft.action}
            onChange={(e) => set({ action: e.target.value as Draft["action"] })}
          >
            <option value="notify">notificar</option>
            <option value="queue">segurar cards novos</option>
          </select>
          <Button variant="outline" onClick={() => void save()}>
            Salvar orçamento
          </Button>
        </div>
      </Panel>
    </section>
  );
}
