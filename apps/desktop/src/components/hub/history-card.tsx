import type { ReactNode } from "react";

/** One indexed session as a card: title, project, host, date, cost, origin, possibly in use. */
export function HistoryCard(props: {
  title: string;
  project: string;
  host: string;
  /** The last activity, already formatted. */
  when: string;
  origin: string;
  cost?: string;
  costLabel: string;
  /** Said when the file changed in the last minutes: another process may still write it. */
  maybeActive?: string;
  /** Said for a run nobody typed. */
  automated?: string;
  current?: boolean;
  onOpen(): void;
  extra?: ReactNode;
}) {
  return <li aria-label={props.title} />;
}
