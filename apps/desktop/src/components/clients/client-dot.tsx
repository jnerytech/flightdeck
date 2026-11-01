import { cn } from "@/lib/utils";
import type { ClientColor } from "../../lib/clients.ts";

/** One class per color, written out so Tailwind finds it; the colors are tokens of the theme. */
const DOTS: Record<ClientColor, string> = {
  indigo: "bg-client-indigo",
  emerald: "bg-client-emerald",
  amber: "bg-client-amber",
  rose: "bg-client-rose",
  sky: "bg-client-sky",
  violet: "bg-client-violet",
  teal: "bg-client-teal",
  orange: "bg-client-orange",
};

/** A client's color as a dot, the same size as a status dot. */
export function ClientDot(props: { color: ClientColor; className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-client-dot={props.color}
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        DOTS[props.color],
        props.className,
      )}
    />
  );
}
