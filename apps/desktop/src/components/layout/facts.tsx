import type { ReactNode } from "react";

/** One line of a `Facts` list: what it is and what it says. */
export interface Fact {
  label: ReactNode;
  value: ReactNode;
}

/** A key/value list: the labels share one column and the values line up in the next. */
export function Facts(props: { items: Fact[] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {props.items.flatMap((item, i) => [
        // biome-ignore lint/suspicious/noArrayIndexKey: the lines have no identity besides their place
        <dt key={`t${i}`} className="text-muted-foreground">
          {item.label}
        </dt>,
        // biome-ignore lint/suspicious/noArrayIndexKey: the lines have no identity besides their place
        <dd key={`d${i}`} className="min-w-0">
          {item.value}
        </dd>,
      ])}
    </dl>
  );
}
