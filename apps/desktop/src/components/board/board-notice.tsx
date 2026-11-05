import { Button } from "@/components/ui/button";

/** What the last bulk action left to say (a refusal), with a way to dismiss it. */
export function BoardNotice(props: { text: string; dismiss: string; onDismiss(): void }) {
  return (
    <div
      role="status"
      className="flex items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm"
    >
      <span>{props.text}</span>
      <Button size="sm" variant="ghost" onClick={props.onDismiss}>
        {props.dismiss}
      </Button>
    </div>
  );
}
