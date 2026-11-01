import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The children of a node of a tree, indented under it with a rule on the left. */
export function TreeBranch(props: { children: ReactNode }) {
  return <ul className="flex flex-col gap-1 border-l pl-3">{props.children}</ul>;
}

/** A node of a tree: its own parts, one under the other, then its branch. */
export function TreeItem(props: {
  /** Names the node for a test or a link to it. */
  id: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <li data-node={props.id} className={cn("flex flex-col gap-1", props.className)}>
      {props.children}
    </li>
  );
}
