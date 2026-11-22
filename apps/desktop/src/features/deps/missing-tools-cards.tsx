import { Info } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { missingTools } from "@/features/setup/index.ts";
import { useT } from "@/i18n/context";
import { Inline } from "@/shared/layout/index.ts";
import type { AppState, AppStore, HostView } from "../../lib/app-store.ts";

/** One card or the Undo that took its place: the one the focus was handed to takes it on mount. */
function useFocusOnMount(wanted: boolean, done: () => void) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!wanted) return;
    ref.current?.focus();
    done();
  }, [wanted, done]);
  return ref;
}

interface Card {
  id: string;
  tool: string;
  host: string;
  title: string;
  fix: string | undefined;
}

function ToolCard(
  props: Readonly<{
    card: Card;
    focus: boolean;
    onFocused(): void;
    onFix(url: string): void;
    onDismiss(): void;
  }>,
) {
  const t = useT();
  const { card } = props;
  const button = useFocusOnMount(props.focus, props.onFocused);
  return (
    <aside
      role="note"
      aria-label={card.title}
      className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3"
    >
      <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-medium text-[13px]">{card.title}</p>
        <p className="text-muted-foreground text-xs">{t("setup.tools.text")}</p>
        {card.fix && (
          <a
            href={card.fix}
            className="w-fit text-xs underline"
            onClick={(e) => {
              e.preventDefault();
              if (card.fix) props.onFix(card.fix);
            }}
          >
            {t("setup.tools.fix")}
          </a>
        )}
      </div>
      <Button
        ref={button}
        variant="ghost"
        size="sm"
        aria-label={t("setup.tools.dismissNamed", { tool: card.tool, host: card.host })}
        onClick={props.onDismiss}
      >
        {t("setup.tools.dismiss")}
      </Button>
    </aside>
  );
}

/** Where a dismissed card was: the way back, with the focus the dismiss button had. */
function UndoRow(
  props: Readonly<{ card: Card; focus: boolean; onFocused(): void; onUndo(): void }>,
) {
  const t = useT();
  const { card } = props;
  const button = useFocusOnMount(props.focus, props.onFocused);
  return (
    <Inline gap={3} className="justify-between">
      <p className="text-muted-foreground text-xs">
        {t("setup.tools.dismissed", { tool: card.tool, host: card.host })}
      </p>
      <Button
        ref={button}
        variant="ghost"
        size="sm"
        aria-label={t("setup.tools.undoNamed", { tool: card.tool, host: card.host })}
        onClick={props.onUndo}
      >
        {t("setup.tools.undo")}
      </Button>
    </Inline>
  );
}

/**
 * A quiet, dismissible card for each tool an online host lacks (the GitHub CLI, `claude`): muted,
 * not a red banner, since a missing tool reduces what the app can do rather than breaking it. A
 * dismissed card leaves an Undo in its place until the screen changes, and a card that arrives
 * after the screen is shown, or a dismissal, is said in a live region.
 */
export function MissingToolsCards(
  props: Readonly<{
    store: AppStore;
    hosts: HostView[];
    deps: AppState["deps"];
  }>,
) {
  const t = useT();
  const { store } = props;
  const dismissed = new Set(
    useSyncExternalStore(store.setup.subscribe, () =>
      store.setup.dismissedTools().join("\n"),
    ).split("\n"),
  );
  /** The cards dismissed since the screen was shown: they keep an Undo. */
  const [undoable, setUndoable] = useState<ReadonlySet<string>>(new Set());
  /** The card whose button holds the focus after a dismiss or an undo. */
  const [focus, setFocus] = useState<string | null>(null);
  /** What the live region says: the last card to arrive or to be dismissed. */
  const [said, setSaid] = useState("");
  const shown = useRef<ReadonlySet<string> | null>(null);

  const all: Card[] = props.hosts
    .filter((host) => host.status === "online")
    .flatMap((host) =>
      missingTools(props.deps[host.id]).map((tool) => ({
        id: `${tool.id}@${host.id}`,
        tool: tool.id,
        host: host.name,
        title: t("setup.tools.title", { tool: tool.id, host: host.name }),
        fix: tool.fix.find((entry) => entry.url)?.url,
      })),
    );
  const cards = all.filter((card) => !dismissed.has(card.id) || undoable.has(card.id));
  /** The cards on show, one `id<TAB>title` line each: it changes when one arrives or goes. */
  const onShow = all
    .filter((card) => !dismissed.has(card.id))
    .map((card) => `${card.id}\t${card.title}`)
    .join("\n");

  useEffect(() => {
    const now = new Map(
      onShow === "" ? [] : onShow.split("\n").map((line) => line.split("\t") as [string, string]),
    );
    const before = shown.current;
    shown.current = new Set(now.keys());
    if (before === null) return;
    const arrived = [...now].filter(([id]) => !before.has(id)).map(([, title]) => title);
    if (arrived.length > 0) setSaid(arrived.join(". "));
  }, [onShow]);

  const focused = useCallback(() => setFocus(null), []);
  const dismiss = (card: Card) => {
    setUndoable((now) => new Set(now).add(card.id));
    setFocus(card.id);
    setSaid(t("setup.tools.dismissed", { tool: card.tool, host: card.host }));
    store.setup.dismissTool(card.id);
  };
  const undo = (card: Card) => {
    setFocus(card.id);
    store.setup.restoreTool(card.id);
  };
  return (
    <>
      <output className="sr-only">{said}</output>
      {cards.map((card) =>
        dismissed.has(card.id) ? (
          <UndoRow
            key={card.id}
            card={card}
            focus={focus === card.id}
            onFocused={focused}
            onUndo={() => undo(card)}
          />
        ) : (
          <ToolCard
            key={card.id}
            card={card}
            focus={focus === card.id}
            onFocused={focused}
            onFix={(url) => store.openLink(url)}
            onDismiss={() => dismiss(card)}
          />
        ),
      )}
    </>
  );
}
