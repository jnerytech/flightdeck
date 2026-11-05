import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A bordered block of a screen: a heading, then its content. */
export function Panel(props: {
  title?: ReactNode;
  /** `li` for an item of a list. */
  as?: "section" | "li";
  /** `sm` is the padding of an item in a list; `md` is a block of the screen. */
  /** `line`: a panel folded to one thin line (the summary in a short area, #232). */
  size?: "md" | "sm" | "line";
  /** Names the block for assistive technology. */
  label?: string;
  /** The block's `data-slot`, for tests and layout checks. */
  slot?: string;
  children: ReactNode;
  className?: string;
}) {
  const Tag = props.as ?? "section";
  const padding = { md: "gap-3 p-4", sm: "gap-2 p-3", line: "gap-2 px-3 py-0.5" }[
    props.size ?? "md"
  ];
  return (
    <Tag
      aria-label={props.label}
      data-slot={props.slot}
      className={cn("flex flex-col rounded-lg border bg-card", padding, props.className)}
    >
      {props.title && <h3 className="font-semibold text-sm">{props.title}</h3>}
      {props.children}
    </Tag>
  );
}
