import { isPreviewUrl } from "@flightdeck/protocol";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { Page } from "@/components/layout/page";
import { Button } from "@/components/ui/button";
import type { AppStore } from "../lib/app-store.ts";

/**
 * A card's running app in a frame. Only the loopback addresses the run.yaml allows open: the
 * address is checked again here, since it comes from a route and not from the file.
 */
export function PreviewPage(props: { store: AppStore; url: string; title: string }) {
  const { store, url, title } = props;
  const { t } = store.i18n;
  const allowed = isPreviewUrl(url);
  return (
    <Page
      fill
      title={title}
      subtitle={url}
      actions={
        allowed && (
          <Button size="sm" variant="outline" onClick={() => store.openLink(url)}>
            {t("runEnv.openBrowser")}
          </Button>
        )
      }
    >
      {allowed ? (
        <iframe
          title={t("runEnv.previewFrame", { title })}
          src={url}
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-forms allow-same-origin"
          className="min-h-0 w-full flex-1 rounded-md border bg-background"
        />
      ) : (
        <InlineNotice>{t("runEnv.previewRefused")}</InlineNotice>
      )}
    </Page>
  );
}
