import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { InlineNotice } from "@/shared/feedback/index.ts";
import { Field, Form, FormActions } from "@/shared/layout/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import { RoiSettingsError } from "../roi/index.ts";
import type { Client } from "./domain/clients.ts";

/** Phase 36: the hourly rate of a client, for every project of it that has none of its own. */
export function ClientRate(props: Readonly<{ store: AppStore; client: Client }>) {
  const { store, client } = props;
  const { t } = store.i18n;
  const stored = store.roi.data().clientRates[client.id];
  const [text, setText] = useState(stored === undefined ? "" : String(stored));
  /** The rate this form just saved (null: none): the page does not re-render on a save, so it leads until the next render reads the store. */
  const [justSaved, setJustSaved] = useState<number | null | undefined>(undefined);
  const field = useRef<HTMLInputElement>(null);
  const [invalid, setInvalid] = useState(false);
  /** What the last save did: a polite line, not silence (#3875). */
  const [done, setDone] = useState<string | null>(null);
  const current = (justSaved === undefined ? stored : justSaved) ?? null;
  const typed = text.trim() === "" ? null : Number(text);
  // A text that is not a number counts as a change, so the refusal can say so.
  const changed = typed !== null && Number.isNaN(typed) ? true : typed !== current;
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
          setJustSaved(rate);
          setText(rate === null ? "" : String(rate));
          setDone(t(rate === null ? "roiUi.clientRate.cleared" : "roiUi.clientRate.saved"));
          // The pressed Save is disabled now: the field takes the focus.
          field.current?.focus();
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
            ref={field}
            inputMode="decimal"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setDone(null);
              setInvalid(false);
            }}
          />
        )}
      </Field>
      <FormActions
        submit={t("roiUi.clientRate.save")}
        disabled={!changed}
        disabledReason={t("clients.unchanged")}
      />
      {done && <InlineNotice tone="info">{done}</InlineNotice>}
      {invalid && <InlineNotice>{t("roiUi.clientRate.invalid")}</InlineNotice>}
    </Form>
  );
}
