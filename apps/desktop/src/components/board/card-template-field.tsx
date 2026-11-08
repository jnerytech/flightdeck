import type { CardTemplate, CardTemplates } from "@flightdeck/protocol";
import { useEffect, useState } from "react";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { Field, NativeSelect } from "@/components/layout/form";
import { useT } from "@/i18n/context";
import type { T } from "@/i18n/index";
import type { AppStore } from "@/lib/app-store";

/** What a template put in the description, so a later pick can replace it and never the person's own words. */
export interface TemplateText {
  description: string;
  filled: string | null;
}

/**
 * The description after the person picked `picked` (`null`: a blank card): the template's text takes
 * the place of an empty description or of the text the last template put there, never of words the
 * person typed.
 */
export function applyTemplate(current: TemplateText, picked: CardTemplate | null): TemplateText {
  const replaceable = current.description.trim() === "" || current.description === current.filled;
  if (!replaceable) return current;
  const text = picked?.description ?? "";
  return { description: text, filled: text === "" ? null : text };
}

/** The workflow a card starts with: its template's, when the project still has it; else none. */
export function startWorkflowOf(card: { startWorkflow: string | null }, names: string[]): string {
  return card.startWorkflow !== null && names.includes(card.startWorkflow)
    ? card.startWorkflow
    : "";
}

/** The picker value of the persona a card starts in: its template's, when the host has it; else none. */
export function startPersonaOf(
  card: { startPersona: string | null },
  hostPersonas: string[],
): string | null {
  return card.startPersona !== null && hostPersonas.includes(card.startPersona)
    ? `host:${card.startPersona}`
    : null;
}

/** What the template sets besides the text, as one phrase; empty when it sets nothing. */
function startsWith(t: T, template: CardTemplate): string {
  const parts = [
    template.workflow && t("kanban.templateWorkflow", { name: template.workflow }),
    template.persona && t("kanban.templatePersona", { name: template.persona }),
    template.pins.length > 0 && t("kanban.templatePins", { n: template.pins.length }),
    template.spec && t("kanban.templateSpec", { path: template.spec }),
  ].filter((part): part is string => typeof part === "string");
  return parts.length > 0 ? t("kanban.templateStarts", { parts: parts.join(", ") }) : "";
}

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
    let live = true;
    void store.hostRequest(hostId, "card.templates", { projectId }).then((result) => {
      if (live && result.ok) setOffer(result.data);
    });
    return () => {
      live = false;
    };
  }, [store, hostId, projectId, enabled]);
  if (!enabled || !offer) return null;
  const picked = offer.templates.find((template) => template.id === props.value) ?? null;
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
