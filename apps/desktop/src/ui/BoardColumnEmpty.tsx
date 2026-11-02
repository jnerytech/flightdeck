import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

/** What an empty board column offers: a ghost button that adds a card. */
export function BoardColumnEmpty(props: { label: string; onAdd(): void }) {
  return (
    <Button variant="ghost" size="sm" onClick={props.onAdd}>
      <Plus aria-hidden="true" />
      {props.label}
    </Button>
  );
}
