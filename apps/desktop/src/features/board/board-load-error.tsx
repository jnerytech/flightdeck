import type { T } from "@/i18n/index.ts";
import { ErrorState } from "@/shared/layout/index.ts";

/** What a board shows when its `board.get` failed: what happened and a retry (#2596). */
export function BoardLoadError(props: Readonly<{ t: T; onRetry(): void }>) {
  return (
    <ErrorState
      message={props.t("states.loadBoardFailed")}
      retryLabel={props.t("states.retry")}
      onRetry={props.onRetry}
    />
  );
}
