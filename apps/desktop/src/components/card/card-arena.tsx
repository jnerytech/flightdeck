import type { Arena, ArenaVariant, Card } from "@flightdeck/protocol";
import { type ReactNode, useEffect, useState } from "react";
import { PersonaPicker } from "@/components/personas/persona-picker";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import type { AppStore } from "@/lib/app-store";
import { ArenaStartForm, type ArenaVariantInput } from "../../ui/ArenaStartForm.tsx";
import { ArenaView, variantBusy } from "../../ui/ArenaView.tsx";
import { ConfirmDialog } from "../../ui/ConfirmDialog.tsx";

/**
 * Phase 13: a card's arena. It owns the comparison, the start form and the variant being chosen,
 * and hands its two parts to the screen: `start`, the button that sits among the card's actions,
 * and `view`, the form, the choose dialog and the comparison further down.
 */
export function CardArena(props: {
  store: AppStore;
  hostId: string;
  card: Card;
  /** The host runs arenas. */
  enabled: boolean;
  personas: boolean;
  /** Changes whenever the card or its run moves on: the comparison is read again. */
  moment: string;
  personaName(id: string): string;
  children(parts: { start: ReactNode; view: ReactNode }): ReactNode;
}) {
  const t = useT();
  const { store, hostId, card } = props;
  const cardId = card.id;
  const [arena, setArena] = useState<Arena | null>(null);
  const [form, setForm] = useState(false);
  const [choosing, setChoosing] = useState<ArenaVariant | null>(null);
  // The comparison follows the card: again whenever it moves on while it has variants.
  const variants = card.arenaVariants ?? 0;
  // The variants run on their own and the card does not change with them: read the comparison
  // again every so often until none of them is still working.
  const busy = arena === null || arena.variants.some(variantBusy);
  const { enabled, moment } = props;
  useEffect(() => {
    if (!enabled || variants === 0 || !moment || !busy) return;
    const load = () => void store.hostCommand(hostId, "card.arena", { cardId }).then(setArena);
    load();
    const timer = setInterval(load, 1000);
    return () => clearInterval(timer);
  }, [store, hostId, cardId, enabled, variants, moment, busy]);

  const start = async (list: ArenaVariantInput[]) => {
    setForm(false);
    const chosen = list.map(({ persona, ...rest }) => {
      const ref = persona ? store.personaRef(persona) : null;
      return { ...rest, ...(ref ? { persona: ref } : {}) };
    });
    setArena(await store.hostCommand(hostId, "card.startArena", { cardId, variants: chosen }));
  };

  const choose = async () => {
    const variant = choosing;
    setChoosing(null);
    if (!variant) return;
    const chosen = await store.hostCommand(hostId, "card.chooseVariant", {
      cardId,
      variantId: variant.id,
      confirm: true,
    });
    if (chosen) setArena(null);
  };

  const startable =
    enabled && variants === 0 && !card.arenaOf && !card.worktreePath && !card.queued && !arena;
  return props.children({
    start: startable && (
      <Button variant="outline" onClick={() => setForm(true)}>
        {t("arenaUi.start")}
      </Button>
    ),
    view: (
      <>
        {form && (
          <ArenaStartForm
            onStart={(list) => void start(list)}
            onClose={() => setForm(false)}
            {...(props.personas && {
              persona: (n: number, value: string, onChange: (value: string) => void) => (
                <PersonaPicker
                  store={store}
                  hostId={hostId}
                  label={t("arenaUi.persona", { n })}
                  value={value}
                  onChange={onChange}
                />
              ),
            })}
          />
        )}
        {choosing && (
          <ConfirmDialog
            message={t("arenaUi.chooseMessage", { name: choosing.label })}
            confirmLabel={t("arenaUi.chooseConfirm")}
            destructive
            onConfirm={() => void choose()}
            onCancel={() => setChoosing(null)}
          />
        )}
        {arena && (
          <ArenaView
            arena={arena}
            loadDiff={(variantId) => store.hostCommand(hostId, "card.diff", { cardId: variantId })}
            onChoose={setChoosing}
            personaName={props.personaName}
          />
        )}
      </>
    ),
  });
}
