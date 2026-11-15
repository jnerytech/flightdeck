import type { CardTemplate, CardTemplates } from "@flightdeck/protocol";
import { useEffect, useState } from "react";
import { useT } from "@/i18n/context";
import type { AppStore } from "@/lib/app-store";
import { InlineNotice } from "@/shared/feedback/index.ts";
import { Field, NativeSelect } from "@/shared/layout/index.ts";
import { startsWith } from "./domain/card-template.ts";

/**
 * The New card dialog's template picker (issue #1201): a blank card or one of the project's card
 * templates, and what the picked one starts the card with. A host that does not offer templates, or
 * a project with none, shows nothing; a file the host did not use says why.
 */
export function CardTemplateField(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    projectId: string;
    /** The host announces cardTemplates. */
    enabled: boolean;
    /** The id of the picked template; `null`: a blank card. */
    value: string | null;
    onPick(template: CardTemplate | null): void;
  }>,
) {
  const t = useT();
  const { store, hostId, projectId, enabled } = props;
  const [offer, setOffer] = useState<CardTemplates | null>(null);
  useEffect(() => {
    if (!enabled) return;
    setOffer(null);
    let live = true;
    void store.hostRequest(hostId, "card.templates", { projectId }).then((result) => {
      if (live && result.ok) setOffer(result.data);
    });
    return () => {
      live = false;
    };
  }, [store, hostId, projectId, enabled]);
  const { value, onPick } = props;
  const picked = offer?.templates.find((template) => template.id === value) ?? null;
  // A template the project no longer offers (its file changed, its trust was revoked) is not sent.
  useEffect(() => {
    if (offer && value !== null && picked === null) onPick(null);
  }, [offer, value, picked, onPick]);
  if (!enabled || !offer) return null;
  return (
    <>
      {offer.ignored && (
        <InlineNotice tone="info">{t(`kanban.templateIgnored.${offer.ignored}`)}</InlineNotice>
      )}
      {offer.templates.length > 0 && (
        <Field
          label={t("kanban.template")}
          help={picked ? startsWith(t, picked) || undefined : undefined}
        >
          {(control) => (
            <NativeSelect
              {...control}
              value={props.value ?? ""}
              onChange={(e) =>
                props.onPick(
                  offer.templates.find((template) => template.id === e.target.value) ?? null,
                )
              }
            >
              <option value="">{t("kanban.templateNone")}</option>
              {offer.templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      )}
      {offer.dropped > 0 && (
        <InlineNotice tone="info">{t("kanban.templateDropped", { n: offer.dropped })}</InlineNotice>
      )}
    </>
  );
}
