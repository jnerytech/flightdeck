import { ClientDot } from "@/components/clients/client-dot";
import { Inline } from "@/components/layout/stack";
import type { ClientColor } from "../../lib/clients.ts";

/** The client of a project or a request, small enough to sit in a header or a row. */
export function ClientChip(props: { name: string; color: ClientColor }) {
  return (
    <div data-client-chip className="shrink-0 text-muted-foreground text-xs">
      <Inline gap={1}>
        <ClientDot color={props.color} />
        {props.name}
      </Inline>
    </div>
  );
}
