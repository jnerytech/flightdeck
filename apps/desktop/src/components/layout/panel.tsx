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
  const Tag = props.as ?? "section";
  const small = props.size === "sm";
  return (
    <Tag
      className={cn(
        "flex flex-col rounded-lg border bg-card",
        small ? "gap-2 p-3" : "gap-3 p-4",
        props.className,
      )}
    >
      {props.title && <h3 className="font-semibold text-sm">{props.title}</h3>}
      {props.children}
    </Tag>
  );
}
