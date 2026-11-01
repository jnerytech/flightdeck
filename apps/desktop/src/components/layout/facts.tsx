import type { ReactNode } from "react";

/** One line of a `Facts` list: what it is and what it says. */
export interface Fact {
  label: ReactNode;
  value: ReactNode;
}

/** A key/value list: the labels share one column and the values line up in the next. */
export function Facts(_props: { items: Fact[] }) {
  return <dl />;
}
