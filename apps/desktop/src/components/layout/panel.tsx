import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A bordered block of a screen: a heading, then its content. */
export function Panel(props: {
  title?: ReactNode;
  /** `li` for an item of a list. */
  as?: "section" | "li";
  /** `sm` is the padding of an item in a list; `md` is a block of the screen. */
  size?: "md" | "sm";
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-3 rounded-lg border bg-card p-4", props.className)}>
      {props.title && <h3 className="font-semibold text-sm">{props.title}</h3>}
      {props.children}
    </section>
  );
}
