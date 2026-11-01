import type { ReactNode } from "react";

/** One row of a list: the title wins the width, the meta gives way first. */
export function ListRow(props: {
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  return <div>{props.title}</div>;
}
