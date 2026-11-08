import { type Card, type KnowledgeEntry, PINNED_DOCS_MAX } from "@flightdeck/protocol";
import { useEffect, useState } from "react";
import { Panel } from "@/components/layout/panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Key } from "@/i18n";
import { useT } from "@/i18n/context";
import { refusalText } from "@/i18n/errors";
import type { AppStore } from "@/lib/app-store";

/**
 * The library documents pinned to a card (issue #76): the session is told to read them when the
 * card starts. `path` is the project's folder, for the picker's list; without it (or without the
 * host's library) the pins can still be seen and taken off. Every change sends the whole list.
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
  const { store, hostId, card, path } = props;
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!props.library || !path) return;
    let live = true;
    void store.hostCommand(hostId, "knowledge.list", { path }).then((result) => {
      if (live && result) setEntries(result.entries);
    });
    return () => {
      live = false;
    };
  }, [store, hostId, path, props.library]);

  const pins = card.pinnedDocs;
  const save = async (next: string[]) => {
    const result = await store.hostRequest(hostId, "card.update", {
      cardId: card.id,
      pinnedDocs: next,
    });
    setProblem(
      result.ok
        ? null
        : t("cardUi.pins.failed", {
            why: refusalText(result.code, result.message, t, result),
          }),
    );
  };
  const word = (entry: KnowledgeEntry) => t(`projectPage.knowledge.status.${entry.status}` as Key);
  const full = pins.length >= PINNED_DOCS_MAX;
  const offered = entries.filter((entry) => !pins.includes(entry.path));
  const title = t("cardUi.pins.title");
  return (
    <Panel title={title} label={title}>
      <p className="text-muted-foreground text-sm">{t("cardUi.pins.hint")}</p>
      {pins.length === 0 ? (
        <p className="text-sm">{t("cardUi.pins.none")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {pins.map((pin) => {
            const known = entries.find((entry) => entry.path === pin);
            return (
              <li key={pin} className="flex flex-wrap items-center gap-2 text-sm">
                {known ? (
                  <>
                    <span className="min-w-0 break-all font-medium">{known.title}</span>
                    <span className="min-w-0 break-all text-muted-foreground">{pin}</span>
                    <Badge variant="outline">{word(known)}</Badge>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 break-all font-medium">{pin}</span>
                    {entries.length > 0 && (
                      <span className="text-muted-foreground">{t("cardUi.pins.unlisted")}</span>
                    )}
                  </>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t("cardUi.pins.unpin", { path: pin })}
                  onClick={() => void save(pins.filter((other) => other !== pin))}
                >
                  {t("cardUi.pins.unpinShort")}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {props.library && path && (
        <>
          <select
            aria-label={t("cardUi.pins.pick")}
            className="w-fit max-w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
            value=""
            disabled={full}
            onChange={(event) => {
              if (event.target.value) void save([...pins, event.target.value]);
            }}
          >
            <option value="">{t("cardUi.pins.pickPlaceholder")}</option>
            {offered.map((entry) => (
              <option key={entry.path} value={entry.path}>
                {`${entry.title} · ${word(entry)}`}
              </option>
            ))}
          </select>
          {full && (
            <p className="text-muted-foreground text-sm">
              {t("cardUi.pins.full", { max: PINNED_DOCS_MAX })}
            </p>
          )}
        </>
      )}
      {problem && (
        <p role="alert" className="text-sm">
          {problem}
        </p>
      )}
    </Panel>
  );
}
