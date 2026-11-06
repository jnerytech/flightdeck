import type { ReactNode } from "react";

/** One column of the Activity board: its name, how many cards, and the cards or "None". */
export function ActivityColumnView(props: {
  name: string;
  count: number;
  none: string;
  children: ReactNode;
}) {
  return (
    <section data-slot="activity-column" aria-label={props.name} className="activity-column">
      <div className="activity-column-head">
        <h2 className="activity-column-name">{props.name}</h2>
        <span data-slot="activity-count" className="activity-column-count">
          {props.count}
        </span>
      </div>
      {props.count === 0 ? (
        <p className="activity-column-none">{props.none}</p>
      ) : (
        <ul className="activity-column-cards">{props.children}</ul>
      )}
    </section>
  );
}
