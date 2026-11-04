import { Page } from "@/components/layout/page";
import type { AppState, AppStore } from "../lib/app-store.ts";
import type { Route } from "../lib/router.ts";

/** Home: the last seven days of every host in four cards. */
export function HomePage(props: { store: AppStore; state: AppState; go(route: Route): void }) {
  const { t } = props.store.i18n;
  return (
    <Page title={t("home.title")}>
      <p />
    </Page>
  );
}
