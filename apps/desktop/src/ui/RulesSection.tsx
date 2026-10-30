import { useEffect, useState } from "react";
import { Panel } from "@/components/layout/panel";
import { Button } from "@/components/ui/button";
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
    <Panel title="Regras" className="">
      <section aria-label="Regras" className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs">
          "Sempre neste projeto", em .claude/settings.local.json.
        </p>
        <ul className="flex flex-col gap-1">
          {rules.map((rule) => (
            <li key={rule} className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-muted px-1 font-mono text-xs">
                {rule}
              </code>
              <Button variant="outline" size="sm" onClick={() => setRemoving(rule)}>
                {`Remover ${rule}`}
              </Button>
            </li>
          ))}
        </ul>
      </section>
      {removing && (
        <ConfirmDialog
          message={`Remover a regra ${removing} do .claude/settings.local.json do projeto?`}
          confirmLabel="Remover regra"
          destructive
          onConfirm={() => void remove(removing)}
          onCancel={() => setRemoving(null)}
        />
      )}
    </Panel>
  );
}
