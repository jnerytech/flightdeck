import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import { ConfirmDialog, InlineNotice } from "@/shared/feedback/index.ts";
import { ErrorState, LoadingState, Panel } from "@/shared/layout/index.ts";
import type { AppStore } from "../../lib/app-store.ts";

/** The project's rules (`permissions.allow` of its `.claude/settings.local.json`), each removable. */
export function RulesSection(
  props: Readonly<{ store: AppStore; hostId: string; projectId: string }>,
) {
  const t = useT();
  const { store, hostId, projectId } = props;
  // null: the list is not read yet (or it failed): never "no rules".
  const [rules, setRules] = useState<string[] | null>(null);
  const [loadRefusal, setLoadRefusal] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removingNow, setRemovingNow] = useState<string | null>(null);
  const [removeRefusal, setRemoveRefusal] = useState<string | null>(null);
  const section = useRef<HTMLElement>(null);

  const load = useCallback(() => {
    setLoadRefusal(null);
    void store.hostRequest(hostId, "rules.list", { projectId }).then((result) => {
      if (result.ok) setRules(result.data.rules);
      else setLoadRefusal(result.message);
    });
  }, [store, hostId, projectId]);
  useEffect(load, [load]);

  const remove = async (rule: string) => {
    setRemoving(null);
    setRemoveRefusal(null);
    setRemovingNow(rule);
    const result = await store.hostRequest(hostId, "rules.remove", {
      projectId,
      rule,
      confirm: true,
    });
    setRemovingNow(null);
    if (!result.ok) {
      setRemoveRefusal(result.message);
      return;
    }
    setRules(result.data.rules);
    // The row and its button are gone: the focus stays in the section.
    section.current?.focus();
  };

  const body = () => {
    if (loadRefusal !== null) {
      return <ErrorState message={loadRefusal} retryLabel={t("rulesUi.retry")} onRetry={load} />;
    }
    if (rules === null) return <LoadingState label={t("rulesUi.loading")} />;
    if (rules.length === 0) {
      return <p className="text-muted-foreground text-sm">{t("rulesUi.empty")}</p>;
    }
    return (
      <ul className="flex flex-col gap-1">
        {rules.map((rule) => (
          <li key={rule} className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded bg-muted px-1 font-mono text-xs">
              {rule}
            </code>
            {removingNow === rule && (
              <span className="text-muted-foreground text-xs">{t("rulesUi.removing")}</span>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={removingNow !== null}
              onClick={() => setRemoving(rule)}
            >
              {t("rulesUi.remove", { rule })}
            </Button>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <Panel title={t("rulesUi.title")} className="">
      <section
        ref={section}
        tabIndex={-1}
        aria-label={t("rulesUi.title")}
        className="flex flex-col gap-2 outline-none"
      >
        <p className="text-muted-foreground text-xs">{t("rulesUi.note")}</p>
        {removeRefusal && <InlineNotice tone="error">{removeRefusal}</InlineNotice>}
        {body()}
      </section>
      {removing && (
        <ConfirmDialog
          message={t("rulesUi.removeMessage", { rule: removing })}
          confirmLabel={t("rulesUi.removeConfirm")}
          destructive
          onConfirm={() => void remove(removing)}
          onCancel={() => setRemoving(null)}
          onRestoreFocus={() => section.current?.focus()}
        />
      )}
    </Panel>
  );
}
