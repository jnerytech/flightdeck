import type { Budget, BudgetInput } from "@flightdeck/protocol";
import { useState } from "react";
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
  return (
    <section aria-label={`Orçamentos de ${props.hostName}`} className="budgets">
      <h3>{`Orçamentos de ${props.hostName}`}</h3>
      <ul>
        {props.budgets.map((budget) => (
          <li key={budget.id}>
            <span>{budgetLine(budget)}</span>
            <button
              type="button"
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
            </button>
            <button
              type="button"
              aria-label={`Remover ${budgetLabel(budget)}`}
              onClick={() => void store.removeBudget(hostId, budget)}
            >
              Remover
            </button>
          </li>
        ))}
      </ul>
      <div className="row">
        <select
          aria-label="Escopo"
          value={draft.scope}
          onChange={(e) => set({ scope: e.target.value as Draft["scope"] })}
        >
          <option value="host">host</option>
          <option value="project">projeto</option>
        </select>
        {draft.scope === "project" && (
          <input
            aria-label="Projeto do orçamento"
            value={draft.projectKey}
            onChange={(e) => set({ projectKey: e.target.value })}
          />
        )}
        <select
          aria-label="Período"
          value={draft.period}
          onChange={(e) => set({ period: e.target.value as Draft["period"] })}
        >
          <option value="day">dia</option>
          <option value="month">mês</option>
        </select>
        <input
          type="number"
          aria-label="Limite (US$)"
          value={draft.limitUsd}
          onChange={(e) => set({ limitUsd: e.target.value })}
        />
        <select
          aria-label="Ação"
          value={draft.action}
          onChange={(e) => set({ action: e.target.value as Draft["action"] })}
        >
          <option value="notify">notificar</option>
          <option value="queue">segurar cards novos</option>
        </select>
        <button type="button" onClick={() => void save()}>
          Salvar orçamento
        </button>
      </div>
    </section>
  );
}
