import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/i18n/context";
import type { AppStore } from "@/lib/app-store";
import type { SnippetChoice } from "./snippet-use";

interface Offer {
  key: string;
  name: string;
  choice: SnippetChoice;
}

/** Phase 18: a terminal tab's Ctrl+Shift+Space: the command snippets of its host and of the app. */
export function SnippetPicker(props: {
  store: AppStore;
  hostId: string;
  onPick(choice: SnippetChoice): void;
  onClose(): void;
}) {
  const t = useT();
  const { store, hostId } = props;
  const [offers, setOffers] = useState<Offer[]>([]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const listed = await store.hostCommand(hostId, "snippets.list", { type: "command" });
      if (!alive) return;
      // The use dialog finds a host's snippet in the list the palette keeps: keep it current.
      if (listed) store.keepSnippets(hostId, listed.snippets);
      setOffers([
        ...(listed?.snippets ?? []).map((s) => ({
          key: `host:${s.id}`,
          name: s.name,
          choice: { hostId, snippetId: s.id },
        })),
        ...store.globalSnippets.list({ type: "command" }).map((s) => ({
          key: `global:${s.id}`,
          name: s.name,
          choice: { hostId: null, snippetId: s.id },
        })),
      ]);
    })();
    return () => {
      alive = false;
    };
  }, [store, hostId]);

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t("snippets.picker")}</DialogTitle>
        </DialogHeader>
        <div role="listbox" aria-label={t("snippets.picker")} className="flex flex-col text-sm">
          {offers.map((offer) => (
            <button
              key={offer.key}
              type="button"
              role="option"
              aria-selected={false}
              className="rounded px-2 py-1 text-left hover:bg-muted"
              onClick={() => props.onPick(offer.choice)}
            >
              {offer.name}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
