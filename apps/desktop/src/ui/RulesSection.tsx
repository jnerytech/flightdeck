import { useEffect, useState } from "react";
import type { AppStore } from "../lib/app-store.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

/** The project's rules (`permissions.allow` of its `.claude/settings.local.json`), each removable. */
export function RulesSection(props: { store: AppStore; hostId: string; projectId: string }) {
  const { store, hostId, projectId } = props;
  const [rules, setRules] = useState<string[]>([]);
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    void store.hostCommand(hostId, "rules.list", { projectId }).then((result) => {
      if (result) setRules(result.rules);
    });
  }, [store, hostId, projectId]);

  const remove = async (rule: string) => {
    setRemoving(null);
    const result = await store.hostCommand(hostId, "rules.remove", {
      projectId,
      rule,
      confirm: true,
    });
    if (result) setRules(result.rules);
  };

  return (
    <section aria-label="Regras" className="rules">
      <h3>Regras</h3>
      <p className="muted">"Sempre neste projeto", em .claude/settings.local.json.</p>
      <ul>
        {rules.map((rule) => (
          <li key={rule}>
            <code>{rule}</code>
            <button type="button" onClick={() => setRemoving(rule)}>
              {`Remover ${rule}`}
            </button>
          </li>
        ))}
      </ul>
      {removing && (
        <ConfirmDialog
          message={`Remover a regra ${removing} do .claude/settings.local.json do projeto?`}
          confirmLabel="Remover regra"
          destructive
          onConfirm={() => void remove(removing)}
          onCancel={() => setRemoving(null)}
        />
      )}
    </section>
  );
}
