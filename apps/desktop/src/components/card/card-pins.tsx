import type { Card } from "@flightdeck/protocol";
import { Panel } from "@/components/layout/panel";
import { useT } from "@/i18n/context";
import type { AppStore } from "@/lib/app-store";

/**
 * The library documents pinned to a card (issue #76): the session is told to read them when the
 * card starts. `path` is the project's folder, for the picker's list; without it (or without the
 * host's library) the pins can still be seen and taken off.
 */
export function CardPins(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    card: Card;
    path: string | null;
    library: boolean;
  }>,
) {
  const t = useT();
  return (
    <Panel title={t("cardUi.pins.title")} label={t("cardUi.pins.title")}>
      <ul>
        {props.card.pinnedDocs.map((path) => (
          <li key={path}>
            {path}
            <button type="button" aria-label={t("cardUi.pins.unpin", { path })}>
              x
            </button>
          </li>
        ))}
      </ul>
      <select aria-label={t("cardUi.pins.pick")}>
        <option value="">{t("cardUi.pins.pickPlaceholder")}</option>
      </select>
    </Panel>
  );
}
