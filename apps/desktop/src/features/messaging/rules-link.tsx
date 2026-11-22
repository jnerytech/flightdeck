import { Button } from "@/components/ui/button";
import type { AppStore } from "../../lib/app-store.ts";

/** A link to the host's messaging rules in Settings, where a paused pair is freed (#4086). */
export function RulesLink(props: Readonly<{ store: AppStore }>) {
  const { store } = props;
  return (
    <Button
      variant="link"
      size="sm"
      onClick={() => store.router.push({ name: "settings", section: "messaging" })}
    >
      {store.i18n.t("messagingRulesUi.open")}
    </Button>
  );
}
