import type { ReactNode } from "react";

/** A short note above a body of text (why a button is disabled), with its action beside it. */
export function Note(props: { children: ReactNode }) {
  return (
    <div role="note" className="m-3 flex flex-wrap items-center gap-3 text-sm">
      {props.children}
    </div>
  );
}
