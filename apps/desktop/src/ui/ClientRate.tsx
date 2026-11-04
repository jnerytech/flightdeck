import { useState } from "react";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { Field, Form, FormActions } from "@/components/layout/form";
import { Input } from "@/components/ui/input";
import type { AppStore } from "../lib/app-store.ts";
import type { Client } from "../lib/clients.ts";
import { RoiSettingsError } from "../lib/roi-settings.ts";

/** Phase 36: the hourly rate of a client, for every project of it that has none of its own. */
export function ClientRate(props: { store: AppStore; client: Client }) {
  const { store, client } = props;
  const { t } = store.i18n;
  const saved = store.roi.data().clientRates[client.id];
  const [text, setText] = useState(saved === undefined ? "" : String(saved));
  const [invalid, setInvalid] = useState(false);
  return (
    <Form
      variant="inline"
      aria-label={t("roiUi.clientRate.form", { name: client.name })}
      onSubmit={() => {
        const rate = text.trim() === "" ? null : Number(text);
        try {
          if (rate !== null && !Number.isFinite(rate)) throw new RoiSettingsError("rate_invalid");
          store.roi.setClientRate(client.id, rate);
          setInvalid(false);
        } catch (error) {
          if (!(error instanceof RoiSettingsError)) throw error;
          setInvalid(true);
        }
      }}
    >
      <Field label={t("roiUi.clientRate.label")} help={t("roiUi.clientRate.help")}>
        {(control) => (
          <Input
            {...control}
            inputMode="decimal"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        )}
      </Field>
      <FormActions submit={t("roiUi.clientRate.save")} />
      {invalid && <InlineNotice>{t("roiUi.clientRate.invalid")}</InlineNotice>}
    </Form>
  );
}
