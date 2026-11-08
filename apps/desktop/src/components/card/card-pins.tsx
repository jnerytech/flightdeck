import { type Card, type KnowledgeEntry, PINNED_DOCS_MAX } from "@flightdeck/protocol";
import { useEffect, useRef, useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
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
 * The select only chooses and Pin pins (#1088): in Chromium on Windows an arrow key on a closed
 * select fires change, so pinning on change pinned each document arrowed past.
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
  const [picked, setPicked] = useState("");
  /** What the last Pin or Unpin did, read out by the status line that is always there. */
  const [said, setSaid] = useState("");
  const picker = useRef<HTMLSelectElement>(null);

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
  const titleOf = (doc: string) => entries.find((entry) => entry.path === doc)?.title ?? doc;
  /** Sends the whole list; on success says what changed. The focus goes back to the picker. */
  const save = async (next: string[], done: string) => {
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
    setSaid(result.ok ? done : "");
    picker.current?.focus();
  };
  const pin = async () => {
    if (!picked) return;
    const doc = picked;
    setPicked("");
    await save([...pins, doc], t("cardUi.pins.pinned", { title: titleOf(doc) }));
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
                  onClick={() =>
                    void save(
                      pins.filter((other) => other !== pin),
                      t("cardUi.pins.unpinned", { title: titleOf(pin) }),
                    )
                  }
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
          <div className="flex flex-wrap items-center gap-2">
            <select
              ref={picker}
              aria-label={t("cardUi.pins.pick")}
              className="w-fit max-w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
              value={picked}
              disabled={full}
              onChange={(event) => setPicked(event.target.value)}
            >
              <option value="">{t("cardUi.pins.pickPlaceholder")}</option>
              {offered.map((entry) => (
                <option key={entry.path} value={entry.path}>
                  {`${entry.title} · ${word(entry)}`}
                </option>
              ))}
            </select>
            <ActionButton
              variant="outline"
              size="sm"
              disabled={full || !picked}
              disabledReason={full ? undefined : t("cardUi.pins.pinNeeded")}
              onClick={pin}
            >
              {t("cardUi.pins.pinAction")}
            </ActionButton>
          </div>
          {full && (
            <p className="text-muted-foreground text-sm">
              {t("cardUi.pins.full", { max: PINNED_DOCS_MAX })}
            </p>
          )}
        </>
      )}
      <p role="status" className="text-sm">
        {said}
      </p>
      {problem && (
        <p role="alert" className="text-sm">
          {problem}
        </p>
      )}
    </Panel>
  );
}
