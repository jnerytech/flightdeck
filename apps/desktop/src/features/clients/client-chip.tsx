import { Inline } from "@/shared/layout/index.ts";
import { ClientDot } from "./client-dot";
import type { ClientColor } from "./domain/clients.ts";

/** The client of a project or a request, small enough to sit in a header or a row. */
export function ClientChip(props: Readonly<{ name: string; color: ClientColor }>) {
  return (
    <div data-client-chip className="shrink-0 text-muted-foreground text-xs">
      <Inline gap={1}>
        <ClientDot color={props.color} />
        {props.name}
      </Inline>
    </div>
  );
}
