import { type Card, specPathProblem, type ValidationTemplate } from "@flightdeck/protocol";
import { useEffect, useState } from "react";
import { type AssistControl, AssistField } from "@/components/assistant/assist-field";
import type { WandBinding } from "@/components/assistant/use-wand";
import { CardSpec } from "@/components/card/card-spec";
import { ActionButton } from "@/components/feedback/action-button";
import { Field } from "@/components/layout/form";
import { Panel } from "@/components/layout/panel";
import { CardHours } from "@/components/roi/card-hours";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Key } from "@/i18n";
import { useT } from "@/i18n/context";
import type { AppStore } from "@/lib/app-store";
import { useDraft } from "@/lib/use-draft";

/**
 * One text field of a card and its Save (issue #170). A draft exists only while the person edits;
 * until then the field shows the card as it is now, so a card that arrives after the screen opens
 * (or changes elsewhere) fills it. A draft keeps the card text it started from: a change made
 * elsewhere meanwhile stops a plain Save, says why and offers Use theirs. After a save the field keeps
 * what was sent until the host's update arrives (#249).
 */
function CardTextField(
  props: Readonly<{
    label: string;
    saveLabel: string;
    /** The card's value now. */
    source: string;
    multiline?: boolean;
    autoFocus?: boolean;
    /** The wand of the field: what it writes (issue #160); a field with no wand has none. */
    assist?: WandBinding;
    /** What the host keeps of a sent text (the title is trimmed). */
    stored(text: string): string;
    /** Whether the text is worth saving, besides being an edit. */
    savable(text: string): boolean;
    /** Why the text cannot be saved at all, when it cannot: said under the disabled Save. */
    problem?(text: string): string | null;
    /** What the empty field stands for. */
    placeholder?: string;
    /** True once the host took it. */
    save(stored: string): Promise<unknown>;
  }>,
) {
  const t = useT();
  const { source } = props;
  const [value, setValue, saved, { stale, saving, drop }] = useDraft(source);
  // Typing the card's own text back is no edit any more: the field follows the card again.
  const edit = (text: string) => (text === source ? drop() : setValue(text));
  const problem = props.problem?.(value) ?? null;
  return (
    <Field label={props.label}>
      {(control) => {
        const input = (assist?: AssistControl) =>
          props.multiline ? (
            <Textarea
              {...control}
              {...assist}
              value={value}
              className="min-h-20 w-full"
              {...(props.placeholder ? { placeholder: props.placeholder } : {})}
              onChange={(e) => edit(e.target.value)}
            />
          ) : (
            <Input
              {...control}
              {...assist}
              className="w-full"
              value={value}
              {...(props.placeholder ? { placeholder: props.placeholder } : {})}
              autoFocus={props.autoFocus === true}
              onChange={(e) => edit(e.target.value)}
            />
          );
        return (
          <div className="field-with-action">
            {props.assist ? (
              <AssistField
                binding={props.assist}
                value={value}
                onChange={edit}
                t={t}
                className="min-w-0 flex-1"
              >
                {input}
              </AssistField>
            ) : (
              <div className="min-w-0 flex-1">{input()}</div>
            )}
            <ActionButton
              variant="outline"
              disabled={!props.savable(value) || stale || saving || problem !== null}
              {...(stale ? { disabledReason: t("cardUi.changedElsewhere") } : {})}
              {...(!stale && problem ? { disabledReason: problem } : {})}
              onClick={async () => {
                const sent = value;
                const stored = props.stored(sent);
                // A refused save keeps the edit (the banner says why), and so does a newer edit
                // typed while this one was on its way (it now starts from what was saved).
                if (await props.save(stored)) saved(sent, stored);
              }}
            >
              {props.saveLabel}
            </ActionButton>
            {stale && (
              <Button variant="ghost" size="sm" onClick={drop}>
                {t("cardUi.useTheirs")}
              </Button>
            )}
          </div>
        );
      }}
    </Field>
  );
}

/** A card's details: its title, its description and, where the host keeps ROI, its hours. */
export function CardFields(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    card: Card;
    /** Opened from the menu's Edit…: the title field takes focus. */
    edit?: boolean;
    withRoi: boolean;
    /** Opens Settings, section Assistant (the wand found no provider). */
    onOpenSettings(): void;
  }>,
) {
  const t = useT();
  const { store, hostId, card } = props;
  // Issue #1058: the project's own shape for a validation note, when its host has one. Quietly: a
  // host that does not know the command (an older daemon) simply has none.
  const [shape, setShape] = useState<ValidationTemplate | null>(null);
  useEffect(() => {
    let live = true;
    void store
      .hostRequest(hostId, "card.validationTemplate", { cardId: card.id })
      .then((result) => {
        if (live && result.ok) setShape(result.data);
      });
    return () => {
      live = false;
    };
  }, [store, hostId, card.id]);
  const update = (
    patch:
      | { title: string }
      | { description: string }
      | { validationNote: string | null }
      | { specPath: string | null },
  ) => store.hostCommand(hostId, "card.update", { cardId: card.id, ...patch });
  return (
    <Panel title={t("cardUi.detailsTitle")} label={t("cardUi.detailsTitle")} slot="card-details">
      <CardTextField
        label={t("cardUi.title")}
        saveLabel={t("cardUi.saveTitle")}
        source={card.title}
        assist={{
          controller: store.assistant,
          kind: "card.title",
          fieldHostId: hostId,
          ...(card.description.trim() ? { context: { description: card.description } } : {}),
          openSettings: props.onOpenSettings,
        }}
        // The menu's Edit… opens the card to change it: the title is where the cursor goes.
        autoFocus={props.edit === true}
        stored={(text) => text.trim()}
        savable={(text) => text.trim() !== "" && text.trim() !== card.title}
        save={(title) => update({ title })}
      />
      <CardTextField
        label={t("cardUi.description")}
        saveLabel={t("cardUi.saveDescription")}
        source={card.description}
        assist={{
          controller: store.assistant,
          kind: "card.description",
          fieldHostId: hostId,
          ...(card.title.trim() ? { context: { title: card.title } } : {}),
          openSettings: props.onOpenSettings,
        }}
        multiline
        stored={(text) => text}
        savable={(text) => text !== card.description}
        save={(description) => update({ description })}
      />
      <CardTextField
        label={t("cardUi.validation")}
        saveLabel={t("cardUi.saveValidation")}
        source={card.validationNote ?? ""}
        // Issue #78: the shape of a validation note, shown and never saved, so it alone meets no check.
        placeholder={shape?.text ?? t("cardUi.validationShape")}
        multiline
        stored={(text) => text.trim()}
        savable={(text) => text.trim() !== (card.validationNote ?? "")}
        save={(text) => update({ validationNote: text === "" ? null : text })}
      />
      {shape?.ignored && (
        <output className="text-muted-foreground text-sm" aria-live="polite">
          {t(`cardUi.validationIgnored.${shape.ignored}` as Key)}
        </output>
      )}
      <CardTextField
        label={t("cardUi.specFile")}
        saveLabel={t("cardUi.saveSpec")}
        source={card.specPath ?? ""}
        placeholder={card.slug ? `docs/specs/${card.slug}.md` : "docs/specs/<card>.md"}
        stored={(text) => text.trim()}
        savable={(text) => text.trim() !== (card.specPath ?? "")}
        problem={(text) =>
          text.trim() !== "" && specPathProblem(text.trim()) !== null
            ? t("cardUi.specPathInvalid")
            : null
        }
        save={(text) => update({ specPath: text === "" ? null : text })}
      />
      <CardSpec store={store} hostId={hostId} card={card} />
      {props.withRoi && <CardHours store={store} hostId={hostId} card={card} />}
    </Panel>
  );
}
