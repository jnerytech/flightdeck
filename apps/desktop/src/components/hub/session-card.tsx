import type { ReactNode } from "react";
import type { StateTone } from "@/components/status/status-dot";

/**
 * One session as a card: title (it opens the session), project, host, status, the last line, the
 * cost and the actions menu.
 */
export function SessionCard(props: {
  title: string;
  project: string;
  host: string;
  stateLabel: string;
  tone: StateTone;
  /** What the session asked and is doing: "Pedido: … · rodando Bash". */
  line: string;
  /** The formatted cost, when the host reports one. */
  cost?: string;
  costLabel: string;
  persona?: string | null;
  /** The session open on the right. */
  current?: boolean;
  /** The row the keyboard is on. */
  active?: boolean;
  onOpen(): void;
  actions?: ReactNode;
}) {
  return <li aria-label={props.title} />;
}
