import { useEffect, useState } from "react";
import { Panel } from "@/components/layout/panel";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import type { AppStore } from "../lib/app-store.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

/** The project's rules (`permissions.allow` of its `.claude/settings.local.json`), each removable. */
export function RulesSection(props: { store: AppStore; hostId: string; projectId: string }) {
  const t = useT();
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
    <Panel title={t("rulesUi.title")} className="">
      <section aria-label={t("rulesUi.title")} className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs">{t("rulesUi.note")}</p>
        {rules.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("rulesUi.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {rules.map((rule) => (
              <li key={rule} className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-muted px-1 font-mono text-xs">
                  {rule}
                </code>
                <Button variant="outline" size="sm" onClick={() => setRemoving(rule)}>
                  {t("rulesUi.remove", { rule })}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {removing && (
        <ConfirmDialog
          message={t("rulesUi.removeMessage", { rule: removing })}
          confirmLabel={t("rulesUi.removeConfirm")}
          destructive
          onConfirm={() => void remove(removing)}
          onCancel={() => setRemoving(null)}
        />
      )}
    </Panel>
  );
}
