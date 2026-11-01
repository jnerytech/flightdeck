import { Fragment, type ReactNode } from "react";

/** One line of a `Facts` list: what it is and what it says. */
export interface Fact {
  /** Tells the line apart from the others, and stays with it as the list changes. */
  id: string;
  label: ReactNode;
  value: ReactNode;
}

/** A key/value list: the labels share one column and the values line up in the next. */
export function Facts(props: { items: Fact[] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {props.items.map((item) => (
        <Fragment key={item.id}>
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0">{item.value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
