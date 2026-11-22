import { ActionButton, InlineNotice } from "@/shared/feedback/index.ts";
import { Inline, Stack } from "@/shared/layout/index.ts";
import type { AppStore } from "../../lib/app-store.ts";

/** The host refused to list its projects: said in place of the loading state, with a way to read again. */
export function ReadFailed(props: Readonly<{ store: AppStore; onRetry(): Promise<unknown> }>) {
  const { t } = props.store.i18n;
  return (
    <Stack gap={2}>
      <InlineNotice tone="error">{t("projectsUi.readFailed")}</InlineNotice>
      <Inline>
        <ActionButton variant="outline" size="sm" onClick={props.onRetry}>
          {t("projectsUi.retry")}
        </ActionButton>
      </Inline>
    </Stack>
  );
}
