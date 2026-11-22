import { useT } from "@/i18n/context";
import type { AppStore } from "@/lib/app-store";
import { ErrorState } from "@/shared/layout/index.ts";

/** The hosts that were asked for their figures and did not answer, named, with a way to ask again. */
export function RoiReadFailed(
  props: Readonly<{ store: AppStore; hostIds: string[]; onRetry(): void }>,
) {
  const t = useT();
  const known = props.store.getState().hosts;
  const hosts = props.hostIds.map((id) => known.find((h) => h.id === id)?.name ?? id).join(", ");
  return (
    <ErrorState
      message={t("roiUi.failed", { hosts })}
      retryLabel={t("roiUi.retry")}
      onRetry={props.onRetry}
    />
  );
}
