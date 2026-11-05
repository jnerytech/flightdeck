import type { Card } from "@flightdeck/protocol";
import { ActionButton } from "@/components/feedback/action-button";
import { Field } from "@/components/layout/form";
import { Panel } from "@/components/layout/panel";
import { CardHours } from "@/components/roi/card-hours";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
function CardTextField(props: {
  label: string;
  saveLabel: string;
  /** The card's value now. */
  source: string;
  multiline?: boolean;
  autoFocus?: boolean;
  /** What the host keeps of a sent text (the title is trimmed). */
  stored(text: string): string;
  /** Whether the text is worth saving, besides being an edit. */
  savable(text: string): boolean;
  /** True once the host took it. */
  save(stored: string): Promise<unknown>;
}) {
  const t = useT();
  const { source } = props;
  const [value, setValue, saved, { stale, saving, drop }] = useDraft(source);
  // Typing the card's own text back is no edit any more: the field follows the card again.
  const edit = (text: string) => (text === source ? drop() : setValue(text));
  return (
    <Field label={props.label}>
      {(control) => (
        <div className="field-with-action">
          {props.multiline ? (
            <Textarea
              {...control}
              value={value}
              className="min-h-20 flex-1"
              onChange={(e) => edit(e.target.value)}
            />
          ) : (
            <Input
              {...control}
              className="flex-1"
              value={value}
              autoFocus={props.autoFocus === true}
              onChange={(e) => edit(e.target.value)}
            />
          )}
          <ActionButton
            variant="outline"
            disabled={!props.savable(value) || stale || saving}
            {...(stale ? { disabledReason: t("cardUi.changedElsewhere") } : {})}
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
      )}
    </Field>
  );
}

/** A card's details: its title, its description and, where the host keeps ROI, its hours. */
export function CardFields(props: {
  store: AppStore;
  hostId: string;
  card: Card;
  /** Opened from the menu's Edit…: the title field takes focus. */
  edit?: boolean;
  withRoi: boolean;
}) {
  const t = useT();
  const { store, hostId, card } = props;
  const update = (patch: { title: string } | { description: string }) =>
    store.hostCommand(hostId, "card.update", { cardId: card.id, ...patch });
  return (
    <Panel title={t("cardUi.detailsTitle")} label={t("cardUi.detailsTitle")} slot="card-details">
      <CardTextField
        label={t("cardUi.title")}
        saveLabel={t("cardUi.saveTitle")}
        source={card.title}
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
        multiline
        stored={(text) => text}
        savable={(text) => text !== card.description}
        save={(description) => update({ description })}
      />
      {props.withRoi && <CardHours store={store} hostId={hostId} card={card} />}
    </Panel>
  );
}
