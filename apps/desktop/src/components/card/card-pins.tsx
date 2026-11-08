import { type Card, type KnowledgeEntry, PINNED_DOCS_MAX } from "@flightdeck/protocol";
import { useEffect, useRef, useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { FieldRow } from "@/components/layout/form";
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
  const statusLine = useRef<HTMLParagraphElement>(null);
  /**
   * Where the focus goes once a save is done (#1088): the picker, or the status line when the
   * picker cannot take it (the pin filled the card, or there is none). Moved after the render, so a
   * picker the card's update enables again can take it, and never left on the page's body.
   */
  const [focusTo, setFocusTo] = useState<"picker" | "status" | null>(null);

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
  const canPick = props.library && path !== null;
  /**
   * Sends the whole list. On success it says what changed and sends the focus on; a refusal says
   * why and moves nothing, so the person is where they were. Returns whether it was kept.
   */
  const save = async (next: string[], done: string): Promise<boolean> => {
    setSaid("");
    const result = await store.hostRequest(hostId, "card.update", {
      cardId: card.id,
      pinnedDocs: next,
    });
    if (!result.ok) {
      setProblem(
        t("cardUi.pins.failed", { why: refusalText(result.code, result.message, t, result) }),
      );
      return false;
    }
    setProblem(null);
    setSaid(done);
    setFocusTo(canPick && next.length < PINNED_DOCS_MAX ? "picker" : "status");
    return true;
  };
  const pin = async () => {
    if (!picked) return;
    if (await save([...pins, picked], t("cardUi.pins.pinned", { title: titleOf(picked) }))) {
      setPicked("");
    }
  };
  const word = (entry: KnowledgeEntry) => t(`projectPage.knowledge.status.${entry.status}` as Key);
  const full = pins.length >= PINNED_DOCS_MAX;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `full` re-runs it once the card's update enables the picker again
  useEffect(() => {
    if (!focusTo) return;
    const select = picker.current;
    // A full card's picker is enabled again only by the card's update: wait for it.
    if (focusTo === "picker" && select?.disabled) return;
    (focusTo === "picker" && select ? select : statusLine.current)?.focus();
    setFocusTo(null);
  }, [focusTo, full]);
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
          <FieldRow>
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
          </FieldRow>
          {full && (
            <p className="text-muted-foreground text-sm">
              {t("cardUi.pins.full", { max: PINNED_DOCS_MAX })}
            </p>
          )}
        </>
      )}
      <p ref={statusLine} role="status" tabIndex={-1} className="text-sm">
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
