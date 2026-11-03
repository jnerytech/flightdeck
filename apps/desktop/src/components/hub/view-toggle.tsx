import { LayoutGrid, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { HubView } from "../../lib/hub.ts";

/** The hub's two views, side by side: the pressed one is on. */
export function ViewToggle(props: {
  view: HubView;
  label: string;
  listLabel: string;
  cardsLabel: string;
  onChange(view: HubView): void;
}) {
  return (
    <fieldset className="m-0 flex gap-0.5 border-0 p-0">
      <legend className="sr-only">{props.label}</legend>
      <Button
        variant="outline"
        size="icon"
        className="size-8"
        aria-label={props.listLabel}
        aria-pressed={props.view === "list"}
        onClick={() => props.onChange("list")}
      >
        <List />
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="size-8"
        aria-label={props.cardsLabel}
        aria-pressed={props.view === "cards"}
        onClick={() => props.onChange("cards")}
      >
        <LayoutGrid />
      </Button>
    </fieldset>
  );
}
