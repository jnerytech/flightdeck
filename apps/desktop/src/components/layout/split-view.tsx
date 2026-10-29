import type { ReactNode } from "react";

/** A list on the left and the detail of the chosen item on the right. */
export function SplitView(_props: {
  list: ReactNode;
  detail: ReactNode | null;
  empty: ReactNode;
  onClose(): void;
  labels: { resize: string };
}) {
  return null;
}
