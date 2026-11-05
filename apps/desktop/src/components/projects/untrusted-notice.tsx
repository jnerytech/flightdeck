import type { ReactNode } from "react";
import type { AppStore } from "@/lib/app-store";

/** A session in a folder the person has not trusted says what did not load (issue #196). A stub here. */
export function UntrustedNotice(_props: {
  store: AppStore;
  hostId: string;
  /** The host announces projectTrust. */
  announced: boolean;
  cwd: string;
  onReview?: () => void;
}): ReactNode {
  return null;
}
