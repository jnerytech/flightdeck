import type { ReactNode } from "react";

/** A narrow column beside a wide one: the side column keeps its width, the main one takes the rest. */
export function TwoPane(props: { side: ReactNode; children: ReactNode }) {
  return (
    <div>
      {props.side}
      {props.children}
    </div>
  );
}
