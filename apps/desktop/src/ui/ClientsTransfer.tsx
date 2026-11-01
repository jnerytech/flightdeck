import { useState } from "react";
import { Field, Form, FormActions } from "@/components/layout/form";
import { Panel } from "@/components/layout/panel";
import { Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { AppStore } from "../lib/app-store.ts";

/** The clients as text, to move to another desktop: copy them out, paste them in. */
export function ClientsTransfer(props: { store: AppStore }) {
  const { store } = props;
  const { t } = store.i18n;
  const [exported, setExported] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [outcome, setOutcome] = useState<string | null>(null);

  const run = () => {
    const done = store.clients.importJson(pasted);
    if (!done) {
      setOutcome(t("clients.importBad"));
      return;
    }
    setOutcome(
      t("clients.imported", {
        added: t(done.added === 1 ? "clients.countNew1" : "clients.countNewN", {
          count: done.added,
        }),
        updated: t(done.updated === 1 ? "clients.countUpdated1" : "clients.countUpdatedN", {
          count: done.updated,
        }),
      }),
    );
    setPasted("");
  };

  return (
    <Panel title={t("clients.transferTitle")}>
      <Stack gap={4}>
        <Stack gap={2}>
          <div>
            <Button variant="outline" onClick={() => setExported(store.clients.exportJson())}>
              {t("clients.export")}
            </Button>
          </div>
          {exported !== null && (
            <Field label={t("clients.exportLabel")}>
              {(control) => <Textarea {...control} readOnly rows={6} value={exported} />}
            </Field>
          )}
        </Stack>
        <Form variant="inline" onSubmit={run}>
          <Field label={t("clients.importLabel")}>
            {(control) => (
              <Textarea
                {...control}
                rows={4}
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
              />
            )}
          </Field>
          <FormActions submit={t("clients.import")} disabled={pasted.trim() === ""} />
          {outcome && <p className="text-muted-foreground text-sm">{outcome}</p>}
        </Form>
      </Stack>
    </Panel>
  );
}
