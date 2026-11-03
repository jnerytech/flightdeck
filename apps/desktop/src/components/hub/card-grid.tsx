import type { ReactNode } from "react";

/** The cards of a group: as many columns as the width allows, none narrower than 16 rem. */
export function CardGrid(props: { children: ReactNode }) {
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-2">{props.children}</ul>
  );
}
