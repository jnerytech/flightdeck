import { ClientDot } from "@/components/clients/client-dot";
import type { ClientColor } from "../../lib/clients.ts";

/** The client of a project or a request, small enough to sit in a header or a row. */
export function ClientChip(props: { name: string; color: ClientColor }) {
  return (
    <span
      data-client-chip
      className="inline-flex shrink-0 items-center gap-1 text-muted-foreground text-xs"
    >
      <ClientDot color={props.color} />
      {props.name}
    </span>
  );
}
