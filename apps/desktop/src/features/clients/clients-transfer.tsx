import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { InlineNotice } from "@/shared/feedback/index.ts";
import { Field, Form, FormActions, Inline, Panel, Stack } from "@/shared/layout/index.ts";
import type { AppStore } from "../../lib/app-store.ts";

/** The clients as text, to move to another desktop: copy them out, paste them in. */
export function ClientsTransfer(props: Readonly<{ store: AppStore }>) {
  const { store } = props;
  const { t } = store.i18n;
  const [exported, setExported] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [outcome, setOutcome] = useState<{ text: string; failed: boolean } | null>(null);

  const run = () => {
    const done = store.clients.importJson(pasted);
    if (!done) {
      setOutcome({ text: t("clients.importBad"), failed: true });
      return;
    }
    setOutcome({
      text: t("clients.imported", {
        added: t(done.added === 1 ? "clients.countNew1" : "clients.countNewN", {
          count: done.added,
        }),
        updated: t(done.updated === 1 ? "clients.countUpdated1" : "clients.countUpdatedN", {
          count: done.updated,
        }),
      }),
      failed: false,
    });
    setPasted("");
  };

  return (
    <Panel title={t("clients.transferTitle")}>
      <Stack gap={4}>
        <Stack gap={2}>
          <Inline gap={2}>
            <Button variant="outline" onClick={() => setExported(store.clients.exportJson())}>
              {t("clients.export")}
            </Button>
            {exported !== null && (
              <Button
                variant="outline"
                onClick={() => void store.system.copyText(exported, t("clients.exportCopied"))}
              >
                {t("clients.exportCopy")}
              </Button>
            )}
          </Inline>
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
          {outcome && (
            <InlineNotice tone={outcome.failed ? "error" : "info"}>{outcome.text}</InlineNotice>
          )}
        </Form>
      </Stack>
    </Panel>
  );
}
